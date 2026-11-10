import { providers, sweepMinimums, sweeps } from "@herald/db/schema";
import { base64 } from "@scure/base";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { encodeFunctionData, hashTypedData, parseAbi, recoverAddress, type Hex } from "viem";
import { z } from "zod";
import { explorerTxUrl, networkRegistry, type Caip2, type Network } from "../networks.ts";
import { USDC_DECIMALS } from "../price.ts";
import { mpcSigners, receivingAddressPaths } from "../receiving-addresses.ts";
import { callJsonRpc, postRpc } from "../rpc.ts";
import {
  EvmAddressSchema,
  ProviderSchema,
  SweepMinimumSchema,
  SweepSchema,
  type HeraldEnv,
  type Provider,
  type Sweep,
  type SweepMinimum,
} from "../schemas.ts";
import { getProviderBalances, type UsdcBalanceReader } from "./balances.ts";
import type { Db } from "./db.ts";

/**
 * How many Sweeps Herald submits for one Provider in any 24 hours, which
 * bounds the gas it spends. A Sweep counts once it is submitted, so
 * planning checks the cap and submission checks it again. The count and the
 * submission aren't one transaction: Sweeps completing at the same moment
 * can go a little over.
 */
export const SWEEP_DAILY_CAP = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

const dailyCapMessage = `Herald submits at most ${SWEEP_DAILY_CAP} Sweeps per Provider in 24 hours. Try again later.`;

/** How many of a Provider's Sweeps Herald submitted in the 24 hours before `now`. */
async function sweepsSubmittedInLastDay(db: Db, providerId: number, now: Date): Promise<number> {
  const [row] = await db
    .select({ submitted: count() })
    .from(sweeps)
    .where(
      and(
        eq(sweeps.providerId, providerId),
        gte(sweeps.submittedAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return row?.submitted ?? 0;
}

/** How long a planned Sweep's authorization stays valid: long enough to sign, short enough not to linger. */
export const SWEEP_VALIDITY_SECONDS = 10 * 60;

// The authorization is valid from a little before it was planned, so a
// chain whose clock lags the Worker's still accepts it.
const VALID_AFTER_SKEW_SECONDS = 60;

/**
 * Gas the Provider's wallet attaches to the MPC `sign` call. The contract
 * refuses less than 15 Tgas (its live `sign_call_gas_attachment_requirement_tera_gas`);
 * about 8 Tgas is burnt and the rest is refunded.
 */
export const MPC_SIGN_GAS = "50000000000000";

/** The MPC `sign` deposit, 1 yoctoNEAR: not a fee, it only rules out function-call keys. */
export const MPC_SIGN_DEPOSIT = "1";

/**
 * The NEAR function call the Provider's wallet sends to have the MPC signer
 * sign a Sweep: `<contractId>.sign({ request })` with `gas` and `deposit`
 * (yoctoNEAR), from the Provider Account. The derivation path and domain
 * are the EVM Receiving Address's, so the signature is that address's.
 */
export type MpcSignRequest = {
  contractId: string;
  methodName: "sign";
  args: {
    request: { payload_v2: { Ecdsa: string }; path: string; domain_id: number };
  };
  gas: string;
  deposit: string;
};

export type SweepPlanRejection =
  | "invalid_request"
  | "unknown_provider"
  | "unsupported_network"
  | "invalid_destination"
  | "below_minimum"
  | "daily_cap_reached"
  | "balance_unavailable"
  | "insufficient_balance";

export type SweepPlan =
  | { ok: true; sweep: Sweep; signRequest: MpcSignRequest }
  | { ok: false; reason: SweepPlanRejection; message: string };

const SweepPlanInputSchema = z.object({
  network: z.string(),
  amount: z.string().regex(/^\d+$/, "The amount must be a whole number of USDC base units"),
  destination: EvmAddressSchema,
});

const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Plans a same-chain Sweep of `amount` USDC (base units) from a Provider's
 * EVM Receiving Address on `network` to `destination` on that network, and
 * records it as `planned`. The plan is an EIP-3009
 * `transferWithAuthorization` valid for `SWEEP_VALIDITY_SECONDS`, and
 * `signRequest` is the NEAR call that has the MPC signer sign its EIP-712
 * hash for the Receiving Address. `now` defaults to the current time.
 */
export async function planSweep(
  deps: { db: Db; readUsdcBalance: UsdcBalanceReader },
  input: {
    providerId: number;
    env: HeraldEnv;
    network: string;
    amount: string;
    destination: string;
    now?: Date;
  },
): Promise<SweepPlan> {
  const parsed = SweepPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    return reject("invalid_request", parsed.error.issues[0]?.message ?? "Invalid Sweep.");
  }
  const { amount, destination } = parsed.data;
  const network = networkRegistry[input.env].find((n) => n.caip2 === parsed.data.network);
  if (network?.kind !== "evm") {
    return reject(
      "unsupported_network",
      `${parsed.data.network} is not an EVM network Herald lists on ${input.env}.`,
    );
  }
  const [row] = await deps.db.select().from(providers).where(eq(providers.id, input.providerId));
  if (!row) return reject("unknown_provider", "No Provider has this id.");
  const provider = ProviderSchema.parse(row);

  const destinationProblem = checkDestination(destination, provider, network);
  if (destinationProblem) return reject("invalid_destination", destinationProblem);

  const minimum = await getSweepMinimum(deps.db, network);
  if (!minimum) {
    return reject(
      "unsupported_network",
      `Herald has no Sweep minimum for USDC on ${network.label}, so it can't Sweep there yet.`,
    );
  }
  if (BigInt(amount) < BigInt(minimum.minimum)) {
    return reject(
      "below_minimum",
      `The minimum Sweep on ${network.label} is ${formatUsdc(minimum.minimum)} USDC.`,
    );
  }

  const now = input.now ?? new Date();
  if ((await sweepsSubmittedInLastDay(deps.db, provider.id, now)) >= SWEEP_DAILY_CAP) {
    return reject("daily_cap_reached", dailyCapMessage);
  }

  // A transfer of more than the balance would revert, with Herald paying
  // the gas.
  let balance: string;
  try {
    balance = await deps.readUsdcBalance({ network, owner: provider.evmAddress });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "sweep_balance_read_failed",
        providerId: provider.id,
        network: network.caip2,
        error: String(error),
      }),
    );
    return reject(
      "balance_unavailable",
      `Herald couldn't read your balance on ${network.label}. Try again later.`,
    );
  }
  if (BigInt(amount) > BigInt(balance)) {
    return reject(
      "insufficient_balance",
      `Your Receiving Address holds ${formatUsdc(balance)} USDC on ${network.label}.`,
    );
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const validAfter = nowSeconds - VALID_AFTER_SKEW_SECONDS;
  const validBefore = nowSeconds + SWEEP_VALIDITY_SECONDS;
  const { nonce, hash } = authorizationPayload(network, {
    from: provider.evmAddress,
    to: destination,
    value: BigInt(amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
  });

  const [inserted] = await deps.db
    .insert(sweeps)
    .values({
      providerId: provider.id,
      sourceNetwork: network.caip2,
      asset: network.usdc.address,
      amount,
      destinationKind: "same_chain",
      destinationNetwork: network.caip2,
      destinationAddress: destination,
      authorizationNonce: nonce,
      validAfter,
      validBefore,
      payloadHash: hash,
      status: "planned",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const sweep = SweepSchema.parse(inserted);
  return { ok: true, sweep, signRequest: signRequestFor(input.env, hash) };
}

/**
 * A NEAR transaction as NEAR RPC's `tx` method reports it, the parts Herald
 * reads: who sent it to which contract with which actions, and its final
 * `status`, which is `{ SuccessValue: <base64> }` once it succeeded (for an
 * MPC `sign` call, the signature), `{ Failure: … }` if it failed, or a
 * string such as `"Started"` while it still runs.
 */
export type NearTransactionOutcome = {
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] };
  status: unknown;
};

/**
 * Reads a NEAR transaction sent by `senderId`, or null if NEAR doesn't know
 * it (yet). Rejects if NEAR can't be asked.
 */
export type NearTransactionReader = (request: {
  txHash: string;
  senderId: string;
}) => Promise<NearTransactionOutcome | null>;

/** A signed EIP-3009 `transferWithAuthorization` (ABI-encoded `data`) on the `asset` contract. */
export type EvmSweepSubmission = { network: Caip2; asset: Hex; data: Hex };

export type EvmSweepSubmissionResult = { ok: true; hash: Hex } | { ok: false; message: string };

/**
 * Hands a Sweep's signed transfer to Herald's chain queue for its network,
 * which pays the gas and answers the transaction hash. Submitting the same
 * authorization again answers the same hash without sending anything. Rejects
 * if the queue can't be reached, in which case submitting again is safe.
 */
export type EvmSweepSubmitter = (
  submission: EvmSweepSubmission,
) => Promise<EvmSweepSubmissionResult>;

/**
 * The RPC interface the `EvmChainQueue` Durable Object offers other Workers
 * through a cross-Worker Durable Object binding, one object per EVM network,
 * named by its CAIP-2 id.
 */
export interface EvmChainQueueRpc {
  /** An `EvmSweepSubmitter` for the queue's network. */
  submitSweep(submission: EvmSweepSubmission): Promise<EvmSweepSubmissionResult>;
}

/**
 * Reads whether an EVM transaction landed: `success`, `reverted`, or null
 * while it has no receipt. Rejects if the chain can't be read.
 */
export type EvmReceiptReader = (request: {
  network: Network;
  hash: string;
}) => Promise<"success" | "reverted" | null>;

/** What completing and following Sweeps needs from outside Herald. */
export type SweepDeps = {
  db: Db;
  readNearTransaction: NearTransactionReader;
  submitSweep: EvmSweepSubmitter;
  readReceipt: EvmReceiptReader;
};

export type SweepCompletionRejection = "invalid_request" | "unknown_sweep" | "near_tx_mismatch";

export type SweepCompletion =
  | { ok: true; sweep: Sweep }
  | { ok: false; reason: SweepCompletionRejection; message: string };

/** A NEAR transaction hash: 32 bytes, base58. */
const NearTxHashSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/, "Not a NEAR transaction hash");

/**
 * Takes the hash of the NEAR transaction in which the Provider's wallet
 * asked the MPC signer to sign a planned Sweep, and carries the Sweep as far
 * as it goes now: `awaiting_signature` until the signature is on NEAR, then
 * `submitted` once the chain queue has the signed transfer. The signature is
 * read from the NEAR transaction itself, never from the browser, and must
 * recover to the Provider's Receiving Address for the planned payload; if
 * it doesn't, the Sweep fails. Sending the same hash again picks up where
 * the Sweep stands (see `refreshSweeps`). `now` defaults to the current time.
 */
export async function completeSweep(
  deps: SweepDeps,
  input: { providerId: number; env: HeraldEnv; sweepId: number; nearTxHash: string; now?: Date },
): Promise<SweepCompletion> {
  const parsedHash = NearTxHashSchema.safeParse(input.nearTxHash);
  if (!parsedHash.success) {
    return { ok: false, reason: "invalid_request", message: "Not a NEAR transaction hash." };
  }
  const nearTxHash = parsedHash.data;
  const found = await ownSweep(deps.db, input.providerId, input.sweepId);
  if (!found) return { ok: false, reason: "unknown_sweep", message: "No such Sweep." };
  const { provider } = found;
  let { sweep } = found;

  if (sweep.status === "planned") {
    const [other] = await deps.db
      .select({ id: sweeps.id })
      .from(sweeps)
      .where(eq(sweeps.nearTxHash, nearTxHash));
    if (other) {
      return {
        ok: false,
        reason: "near_tx_mismatch",
        message: `NEAR transaction ${nearTxHash} belongs to another Sweep.`,
      };
    }
    try {
      await deps.db
        .update(sweeps)
        .set({ status: "awaiting_signature", nearTxHash, updatedAt: new Date() })
        .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "planned")));
    } catch (error) {
      // `near_tx_hash` is unique: another Sweep took this hash since the
      // check above.
      logSweep("sweep_near_tx_conflict", sweep, { nearTxHash, error: String(error) }, "warn");
      return {
        ok: false,
        reason: "near_tx_mismatch",
        message: `NEAR transaction ${nearTxHash} belongs to another Sweep.`,
      };
    }
    sweep = await readSweep(deps.db, sweep.id);
  }
  if (sweep.nearTxHash !== nearTxHash) {
    return {
      ok: false,
      reason: "near_tx_mismatch",
      message: `This Sweep belongs to NEAR transaction ${sweep.nearTxHash ?? "(none)"}.`,
    };
  }
  return {
    ok: true,
    sweep: await advance(deps, { provider, sweep, env: input.env, now: input.now }),
  };
}

/**
 * One chain a Provider can Sweep from: its EVM Receiving Address, the USDC
 * balance there (or why it couldn't be read), and the minimum Sweep in base
 * units, null if Herald has none for the chain (it can't Sweep there).
 */
export type SweepChainOption = {
  network: Caip2;
  label: string;
  address: string;
  balance: { ok: true; amount: string } | { ok: false; message: string };
  minimum: string | null;
};

export type SweepOptions = {
  /** The EVM networks of the Herald environment, in Payment Option order. */
  chains: SweepChainOption[];
  /** Sweeps Herald submitted for the Provider in the last 24 hours. */
  submittedToday: number;
  dailyCap: number;
};

/**
 * What a Provider can Sweep now: every EVM chain of `env` with the live
 * balance (see `getProviderBalances`) and the minimum, and how much of the
 * daily cap is used. Null if no Provider has this id.
 */
export async function getSweepOptions(
  deps: { db: Db; readUsdcBalance: UsdcBalanceReader; timeoutMs?: number },
  input: { providerId: number; env: HeraldEnv; now?: Date },
): Promise<SweepOptions | null> {
  const balances = await getProviderBalances(deps, input);
  if (!balances) return null;
  const chains: SweepChainOption[] = [];
  for (const network of networkRegistry[input.env]) {
    const read = balances.find((b) => b.network === network.caip2);
    if (network.kind !== "evm" || !read) continue;
    const minimum = await getSweepMinimum(deps.db, network);
    chains.push({
      network: network.caip2,
      label: network.label,
      address: read.address,
      balance: read.ok ? { ok: true, amount: read.amount } : { ok: false, message: read.message },
      minimum: minimum?.minimum ?? null,
    });
  }
  return {
    chains,
    submittedToday: await sweepsSubmittedInLastDay(
      deps.db,
      input.providerId,
      input.now ?? new Date(),
    ),
    dailyCap: SWEEP_DAILY_CAP,
  };
}

/** How many Sweeps `refreshSweeps` lists by default. */
export const SWEEP_LIST_LIMIT = 20;

/**
 * One of a Provider's Sweeps with its network's name and block explorer
 * links: `sourceTxUrl` for the transfer, `nearTxUrl` for the NEAR signing
 * transaction. Each is null until the transaction exists.
 */
export type SweepEntry = Sweep & {
  label: string;
  sourceTxUrl: string | null;
  nearTxUrl: string | null;
};

/**
 * Moves every unfinished Sweep of a Provider on as far as it goes now, then
 * lists its latest Sweeps (up to `limit`, default `SWEEP_LIST_LIMIT`),
 * newest first:
 *
 * - `planned` past its authorization's expiry fails: it was never signed.
 * - `awaiting_signature` reads the signature from NEAR and submits it (see
 *   `completeSweep`), or fails once the authorization expired.
 * - `submitted` reads the transfer's receipt: `confirmed` if it succeeded,
 *   `failed` if it reverted, or if it still has none well after the
 *   authorization expired (it can no longer execute).
 *
 * A chain or NEAR read that fails leaves the Sweep as it is for the next
 * refresh. `now` defaults to the current time.
 */
export async function refreshSweeps(
  deps: SweepDeps,
  input: { providerId: number; env: HeraldEnv; now?: Date; limit?: number },
): Promise<SweepEntry[]> {
  const [providerRow] = await deps.db
    .select()
    .from(providers)
    .where(eq(providers.id, input.providerId));
  if (!providerRow) return [];
  const provider = ProviderSchema.parse(providerRow);
  const unfinished = await deps.db
    .select()
    .from(sweeps)
    .where(
      and(
        eq(sweeps.providerId, provider.id),
        inArray(sweeps.status, ["planned", "awaiting_signature", "submitted"]),
      ),
    );
  for (const row of unfinished) {
    await advance(deps, {
      provider,
      sweep: SweepSchema.parse(row),
      env: input.env,
      now: input.now,
    });
  }

  const latest = await deps.db
    .select()
    .from(sweeps)
    .where(eq(sweeps.providerId, provider.id))
    .orderBy(desc(sweeps.createdAt), desc(sweeps.id))
    .limit(input.limit ?? SWEEP_LIST_LIMIT);
  return latest.map((row) => sweepEntry(input.env, SweepSchema.parse(row)));
}

const nearTxExplorers = {
  testnet: "https://testnet.nearblocks.io/txns/",
  mainnet: "https://nearblocks.io/txns/",
} as const satisfies Record<HeraldEnv, string>;

function sweepEntry(env: HeraldEnv, sweep: Sweep): SweepEntry {
  const network = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  return {
    ...sweep,
    label: network?.label ?? sweep.sourceNetwork,
    sourceTxUrl: network && sweep.sourceTxHash ? explorerTxUrl(network, sweep.sourceTxHash) : null,
    nearTxUrl: sweep.nearTxHash
      ? `${nearTxExplorers[env]}${encodeURIComponent(sweep.nearTxHash)}`
      : null,
  };
}

// A transfer without a receipt this long after its authorization expired
// can no longer execute, so the Sweep has failed.
const UNMINED_GRACE_SECONDS = 5 * 60;

type SweepContext = { provider: Provider; sweep: Sweep; env: HeraldEnv; now?: Date };

/** Moves a Sweep on from where it stands, as far as it can go now. */
async function advance(deps: SweepDeps, context: SweepContext): Promise<Sweep> {
  const { sweep } = context;
  const nowSeconds = Math.floor((context.now ?? new Date()).getTime() / 1000);
  switch (sweep.status) {
    case "planned":
      if (nowSeconds < sweep.validBefore) return sweep;
      return fail(deps.db, sweep, "It wasn't signed before its authorization expired.");
    case "awaiting_signature":
      if (nowSeconds >= sweep.validBefore) {
        return fail(
          deps.db,
          sweep,
          "The MPC signature didn't arrive before the authorization expired. Start a new Sweep.",
        );
      }
      return awaitSignature(deps, context);
    case "submitted":
      return awaitReceipt(deps, context, nowSeconds);
    default:
      return sweep;
  }
}

async function awaitReceipt(
  deps: SweepDeps,
  { sweep, env }: SweepContext,
  nowSeconds: number,
): Promise<Sweep> {
  const network = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  if (!network || !sweep.sourceTxHash) return sweep;
  let receipt: "success" | "reverted" | null;
  try {
    receipt = await deps.readReceipt({ network, hash: sweep.sourceTxHash });
  } catch (error) {
    logSweep("sweep_receipt_read_failed", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (receipt === "success") {
    await deps.db
      .update(sweeps)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "submitted")));
    logSweep("sweep_confirmed", sweep, { sourceTxHash: sweep.sourceTxHash });
    return readSweep(deps.db, sweep.id);
  }
  if (receipt === "reverted") {
    return fail(deps.db, sweep, `The transfer reverted on ${network.label}.`);
  }
  if (nowSeconds >= sweep.validBefore + UNMINED_GRACE_SECONDS) {
    return fail(
      deps.db,
      sweep,
      `The transfer wasn't mined on ${network.label} before its authorization expired.`,
    );
  }
  return sweep;
}

async function awaitSignature(deps: SweepDeps, context: SweepContext): Promise<Sweep> {
  const { provider, sweep } = context;
  if (!sweep.nearTxHash) return sweep;
  let outcome: NearTransactionOutcome | null;
  try {
    outcome = await deps.readNearTransaction({
      txHash: sweep.nearTxHash,
      senderId: provider.accountId,
    });
  } catch (error) {
    logSweep("sweep_near_read_failed", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (!outcome) return sweep;

  const status = outcome.status as { SuccessValue?: unknown; Failure?: unknown } | null;
  if (status?.Failure !== undefined) {
    logSweep("sweep_near_tx_failed", sweep, { failure: status.Failure }, "warn");
    return fail(
      deps.db,
      sweep,
      `NEAR transaction ${sweep.nearTxHash} failed, so the MPC signer didn't sign this Sweep.`,
    );
  }
  if (typeof status?.SuccessValue !== "string") return sweep;
  const signature = parseMpcSignature(status.SuccessValue);
  if (!signature) return fail(deps.db, sweep, "The MPC signer's answer isn't an ECDSA signature.");
  const signer = await recoverAddress({ hash: sweep.payloadHash as Hex, signature });
  if (signer.toLowerCase() !== provider.evmAddress.toLowerCase()) {
    return fail(
      deps.db,
      sweep,
      `The signature in NEAR transaction ${sweep.nearTxHash} isn't your Receiving Address's signature of this Sweep.`,
    );
  }

  if (
    (await sweepsSubmittedInLastDay(deps.db, provider.id, context.now ?? new Date())) >=
    SWEEP_DAILY_CAP
  ) {
    return fail(deps.db, sweep, dailyCapMessage);
  }

  const data = encodeFunctionData({
    abi: transferWithAuthorizationAbi,
    functionName: "transferWithAuthorization",
    args: [
      provider.evmAddress as Hex,
      sweep.destinationAddress as Hex,
      BigInt(sweep.amount),
      BigInt(sweep.validAfter),
      BigInt(sweep.validBefore),
      sweep.authorizationNonce as Hex,
      27 + signature.yParity,
      signature.r,
      signature.s,
    ],
  });
  let submitted: EvmSweepSubmissionResult;
  try {
    submitted = await deps.submitSweep({
      network: sweep.sourceNetwork,
      asset: sweep.asset as Hex,
      data,
    });
  } catch (error) {
    // Safe to submit again: the queue answers the same hash for the same
    // authorization.
    logSweep("sweep_submission_unanswered", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (!submitted.ok) {
    return fail(deps.db, sweep, `Herald couldn't submit the transfer: ${submitted.message}`);
  }
  const now = context.now ?? new Date();
  await deps.db
    .update(sweeps)
    .set({ status: "submitted", sourceTxHash: submitted.hash, submittedAt: now, updatedAt: now })
    .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "awaiting_signature")));
  logSweep("sweep_submitted", sweep, { sourceTxHash: submitted.hash });
  return readSweep(deps.db, sweep.id);
}

const transferWithAuthorizationAbi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

const MpcSignatureSchema = z.object({
  scheme: z.literal("Secp256k1"),
  big_r: z.object({ affine_point: z.string().regex(/^0[23][0-9a-fA-F]{64}$/) }),
  s: z.object({ scalar: z.string().regex(/^[0-9a-fA-F]{64}$/) }),
  recovery_id: z.union([z.literal(0), z.literal(1)]),
});

/**
 * The MPC signer's answer to an ECDSA `sign` (base64 JSON, as NEAR returns
 * it) as an EVM signature: `r` is the x-coordinate of `big_r`, `s` is
 * already low-s, and `recovery_id` is the y parity. Null if it isn't one.
 */
function parseMpcSignature(successValue: string): { r: Hex; s: Hex; yParity: 0 | 1 } | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(base64.decode(successValue)));
  } catch {
    return null;
  }
  const parsed = MpcSignatureSchema.safeParse(json);
  if (!parsed.success) return null;
  const { big_r, s, recovery_id } = parsed.data;
  return {
    r: `0x${big_r.affine_point.slice(2).toLowerCase()}`,
    s: `0x${s.scalar.toLowerCase()}`,
    yParity: recovery_id,
  };
}

async function fail(db: Db, sweep: Sweep, error: string): Promise<Sweep> {
  await db
    .update(sweeps)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, sweep.status)));
  logSweep("sweep_failed", sweep, { error }, "warn");
  return readSweep(db, sweep.id);
}

async function ownSweep(
  db: Db,
  providerId: number,
  sweepId: number,
): Promise<{ provider: Provider; sweep: Sweep } | null> {
  const [row] = await db
    .select({ sweep: sweeps, provider: providers })
    .from(sweeps)
    .innerJoin(providers, eq(providers.id, sweeps.providerId))
    .where(and(eq(sweeps.id, sweepId), eq(sweeps.providerId, providerId)));
  return row
    ? { provider: ProviderSchema.parse(row.provider), sweep: SweepSchema.parse(row.sweep) }
    : null;
}

async function readSweep(db: Db, sweepId: number): Promise<Sweep> {
  const [row] = await db.select().from(sweeps).where(eq(sweeps.id, sweepId));
  return SweepSchema.parse(row);
}

function logSweep(
  event: string,
  sweep: Sweep,
  details: Record<string, unknown>,
  level: "log" | "warn" = "log",
): void {
  console[level](
    JSON.stringify({
      event,
      sweepId: sweep.id,
      providerId: sweep.providerId,
      network: sweep.sourceNetwork,
      ...details,
    }),
  );
}

// NEAR RPC holds a `tx` request open until the transaction has executed,
// and answers TIMEOUT_ERROR after about 10 s.
const NEAR_TX_READ_TIMEOUT_MS = 15_000;

/**
 * A `NearTransactionReader` that calls `tx` over NEAR JSON-RPC, waiting for
 * the transaction and its receipts to execute (`EXECUTED_OPTIMISTIC`). A
 * transaction NEAR doesn't know yet, or still executing when the node stops
 * waiting, reads as null. Its errors never name `rpcUrl`, which may carry an
 * API key.
 */
export function nearRpcTransactionReader(
  rpcUrl: string,
  fetchFn: typeof fetch = fetch,
): NearTransactionReader {
  return async ({ txHash, senderId }) => {
    const response = await postRpc(
      fetchFn,
      rpcUrl,
      {
        jsonrpc: "2.0",
        id: "herald",
        method: "tx",
        params: {
          tx_hash: txHash,
          sender_account_id: senderId,
          wait_until: "EXECUTED_OPTIMISTIC",
        },
      },
      "NEAR RPC tx",
      AbortSignal.timeout(NEAR_TX_READ_TIMEOUT_MS),
    );
    const body = (await response.json()) as {
      result?: Partial<NearTransactionOutcome>;
      error?: { cause?: { name?: string } };
    };
    const cause = body.error?.cause?.name;
    if (cause === "UNKNOWN_TRANSACTION" || cause === "TIMEOUT_ERROR") return null;
    if (body.error || !body.result) {
      throw new Error(`NEAR RPC tx(${txHash}) failed: ${JSON.stringify(body.error ?? body)}`);
    }
    const { transaction, status } = body.result;
    // Not executed yet: the node answers its stage without an outcome.
    if (!transaction || status === undefined) return null;
    return { transaction, status };
  };
}

const RECEIPT_READ_TIMEOUT_MS = 8_000;

/**
 * An `EvmReceiptReader` over each chain's JSON-RPC endpoint
 * (`eth_getTransactionReceipt`), from `rpcUrls` keyed by CAIP-2 network.
 * Errors never include the endpoint, whose URL may carry an API key.
 */
export function rpcEvmReceiptReader(
  rpcUrls: Partial<Record<Caip2, string>>,
  fetchFn: typeof fetch = fetch,
): EvmReceiptReader {
  return async ({ network, hash }) => {
    const url = rpcUrls[network.caip2];
    if (!url) throw new Error(`Herald has no RPC endpoint for ${network.label}`);
    const receipt = (await callJsonRpc(
      fetchFn,
      url,
      network.label,
      "eth_getTransactionReceipt",
      [hash],
      RECEIPT_READ_TIMEOUT_MS,
    )) as { status?: unknown } | null;
    if (receipt === null || receipt === undefined) return null;
    return receipt.status === "0x1" ? "success" : "reverted";
  };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Why `destination` can't receive a Sweep on `network`, or null if it can.
 * Sending to the Receiving Address itself does nothing, and USDC sent to
 * the zero address or the USDC contract is lost.
 */
function checkDestination(
  destination: string,
  provider: Provider,
  network: Network,
): string | null {
  const to = destination.toLowerCase();
  if (to === provider.evmAddress.toLowerCase()) {
    return "That's your Receiving Address. Sweep to another address.";
  }
  if (to === ZERO_ADDRESS || to === network.usdc.address.toLowerCase()) {
    return `USDC sent to ${destination} on ${network.label} is lost. Sweep to an address you control.`;
  }
  return null;
}

/**
 * The minimum Sweep of USDC on `network`, from the `sweep_minimums` table,
 * or null if Herald has none for it.
 */
export async function getSweepMinimum(db: Db, network: Network): Promise<SweepMinimum | null> {
  const [row] = await db
    .select()
    .from(sweepMinimums)
    .where(
      and(eq(sweepMinimums.network, network.caip2), eq(sweepMinimums.asset, network.usdc.address)),
    );
  return row ? SweepMinimumSchema.parse(row) : null;
}

// The field size of secp256k1. The MPC signer reads an ECDSA payload as a
// field element and refuses one at or above it.
const SECP256K1_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;

/**
 * A fresh random authorization nonce and the EIP-712 hash of the
 * `TransferWithAuthorization` it makes, under the network's USDC domain.
 */
function authorizationPayload(
  network: Extract<Network, { kind: "evm" }>,
  message: { from: string; to: string; value: bigint; validAfter: bigint; validBefore: bigint },
): { nonce: Hex; hash: Hex } {
  for (;;) {
    const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const hash = hashTypedData({
      domain: {
        name: network.usdc.eip712.name,
        version: network.usdc.eip712.version,
        chainId: evmChainId(network.caip2),
        verifyingContract: network.usdc.address as Hex,
      },
      types: transferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: { ...message, from: message.from as Hex, to: message.to as Hex, nonce },
    });
    // Happens with probability about 2^-128; a new nonce gives a new hash.
    if (BigInt(hash) < SECP256K1_P) return { nonce, hash };
  }
}

function signRequestFor(env: HeraldEnv, payloadHash: Hex): MpcSignRequest {
  const { path, domainId } = receivingAddressPaths.evm;
  return {
    contractId: mpcSigners[env].contractId,
    methodName: "sign",
    args: {
      request: { payload_v2: { Ecdsa: payloadHash.slice(2) }, path, domain_id: domainId },
    },
    gas: MPC_SIGN_GAS,
    deposit: MPC_SIGN_DEPOSIT,
  };
}

/** The chain id of an `eip155:<id>` network. */
function evmChainId(network: Caip2): number {
  return Number(network.slice("eip155:".length));
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** USDC base units as a plain decimal: `"150000"` is `"0.15"`. */
function formatUsdc(baseUnits: string): string {
  const digits = baseUnits.padStart(USDC_DECIMALS + 1, "0");
  const fraction = digits.slice(-USDC_DECIMALS).replace(/0+$/, "");
  const whole = digits.slice(0, -USDC_DECIMALS);
  return fraction ? `${whole}.${fraction}` : whole;
}

function reject(reason: SweepPlanRejection, message: string): SweepPlan {
  return { ok: false, reason, message };
}
