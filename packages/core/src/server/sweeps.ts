import { providers, sweepMinimums, sweeps } from "@herald/db/schema";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { isAddress } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { hexToBytes } from "@noble/hashes/utils.js";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, max, ne, or } from "drizzle-orm";
import { encodeFunctionData, hashTypedData, parseAbi, recoverAddress, type Hex } from "viem";
import { z } from "zod";
import {
  explorerTxUrl,
  networkRegistry,
  unhandledKind,
  type Caip2,
  type Network,
} from "../networks.ts";
import { USDC_DECIMALS } from "../price.ts";
import {
  mpcSigners,
  receivingAddressOn,
  receivingAddressPaths,
  sameAddress,
} from "../receiving-addresses.ts";
import { callJsonRpc, postRpc } from "../rpc.ts";
import {
  EvmAddressSchema,
  NEAR_INTENTS_NETWORK,
  NearAccountIdSchema,
  NearImplicitAccountSchema,
  SweepDestinationKindSchema,
  SweepMinimumSchema,
  SweepSchema,
  type EvmSweep,
  type HeraldEnv,
  type NearSweep,
  type Provider,
  type SolanaSweep,
  type Sweep,
  type SweepMinimum,
} from "../schemas.ts";
import { getProviderBalances, type UsdcBalanceReader } from "./balances.ts";
import type { Db } from "./db.ts";
import {
  oneClickUsdcAsset,
  type OneClickClient,
  type OneClickQuote,
  type OneClickSwap,
} from "./one-click.ts";
import type {
  NearProviderAccountResult,
  NearSponsoredSignResult,
  NearSweepQueue,
  NearSweepSubmissionResult,
} from "./near-chain-queue.ts";
import { nearDelegatePayloadHash, signedNearDelegate } from "./near-protocol.ts";
import {
  nearSweepDelegateAction,
  type NearSweepReader,
  type NearSweepStatus,
} from "./near-sweeps.ts";
import { providerFromRow } from "./providers.ts";
import { mpcPayloadKey, readSponsoredSign } from "./sponsored-signs.ts";
import {
  buildSolanaSweepTransaction,
  SYSTEM_PROGRAM_ADDRESS,
  solanaTransactionMessage,
  TOKEN_2022_PROGRAM_ADDRESS,
  usdcTokenAccount,
  withSolanaSignature,
  type SolanaSweepQueue,
  type SolanaSweepReader,
  type SolanaSweepSubmissionResult,
} from "./solana-sweeps.ts";

type EvmNetwork = Extract<Network, { kind: "evm" }>;
type SolanaNetwork = Extract<Network, { kind: "solana" }>;
type NearNetwork = Extract<Network, { kind: "near" }>;

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

/** How long a planned EVM Sweep's authorization stays valid: long enough to sign, short enough not to linger. */
export const SWEEP_VALIDITY_SECONDS = 10 * 60;

/**
 * How long a planned Solana Sweep can be signed, by the server's clock: an
 * upper bound on its blockhash's lifetime, generous on purpose. A blockhash
 * lasts 150 blocks, about 60 to 70 s at Solana's block times, and the exact
 * limit is the Sweep's `lastValidBlockHeight`, which the chain enforces: a
 * transaction signed too late is refused when the queue submits it. Past
 * this bound, an unsigned Sweep fails, as does one whose signature still
 * isn't on NEAR.
 */
export const SOLANA_SWEEP_VALIDITY_SECONDS = 120;

/**
 * How long a planned NEAR Sweep can be signed, by the server's clock, as
 * long as an EVM Sweep. Its delegate action lands up to
 * `nearMaxBlockHeight`, which the chain enforces: this many seconds of
 * `NEAR_FASTEST_BLOCK_MS` blocks past the final height at planning.
 */
export const NEAR_SWEEP_VALIDITY_SECONDS = 10 * 60;

/**
 * A NEAR block time at or below the fastest Herald expects, for turning a
 * NEAR Sweep's signing window into blocks. Blocks take 0.578 s on testnet
 * and 0.589 s on mainnet (measured over 1000 blocks on 2026-11-12). The
 * chain only enforces a block height, and slower blocks make that height
 * come later, so counting 0.5 s blocks makes the delegate action outlast
 * `validBefore` (by about 90 s at the measured times): a Sweep signed
 * before the deadline Herald shows hasn't expired on chain.
 */
const NEAR_FASTEST_BLOCK_MS = 500;

/**
 * How many blocks past a NEAR Sweep's `nearMaxBlockHeight` Herald waits for
 * its relayer transaction to have executed before it counts the Sweep as
 * never landed: one included in time has executed long before (about a
 * minute).
 */
const NEAR_UNLANDED_GRACE_BLOCKS = 100;

/**
 * The `deadline` Herald asks 1Click for: past it, 1Click refunds a swap that
 * hasn't completed, and its deposit address goes inactive (a deposit after
 * it may be lost).
 */
export const ONE_CLICK_DEADLINE_SECONDS = 30 * 60;

/**
 * How long before a 1Click quote's deadline its transfer must be signed: the
 * transfer can't execute later (EIP-3009 `validBefore`, or the Solana
 * blockhash), so it lands well before the deposit address goes inactive.
 */
export const ONE_CLICK_DEPOSIT_MARGIN_SECONDS = 10 * 60;

/** A 1Click quote that leaves less than this to sign is refused, and the Provider asks again. */
const MIN_QUOTE_SIGNING_SECONDS = 30;

/**
 * The largest share of a 1Click Sweep, in percent, that 1Click may keep if
 * it refunds (its `refundFee`). Refunds are rare on these USDC-to-USDC
 * routes, but some are dear: from Solana 1Click keeps about 0.22 USDC, so a
 * smaller Sweep would come back nearly empty. A quote with a higher refund
 * fee is refused with the least amount that passes.
 */
export const MAX_REFUND_FEE_PERCENT = 10n;

/**
 * How long after a 1Click quote's deadline Herald keeps waiting for 1Click
 * to see a deposit that landed. Past it the deposit address is inactive and
 * the Sweep fails, saying where the USDC sits.
 */
export const ONE_CLICK_PICKUP_GRACE_SECONDS = 60 * 60;

/**
 * The slippage Herald allows 1Click, in basis points. Every route is USDC to
 * USDC, so the quoted output barely moves; below `minAmountOut`, 1Click
 * refunds.
 */
export const ONE_CLICK_SLIPPAGE_BPS = 50;

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
 * are the source Receiving Address's, so the signature is that address's:
 * an ECDSA signature of a 32-byte hash (`Ecdsa`, hex) for the EVM one, an
 * Ed25519 signature of the transaction message (`Eddsa`, hex) for the
 * Solana one, and of the delegate action's 32-byte NEP-461 hash for the
 * NEAR one.
 */
export type MpcSignRequest = {
  contractId: string;
  methodName: "sign";
  args: {
    request: {
      payload_v2: { Ecdsa: string } | { Eddsa: string };
      path: string;
      domain_id: number;
    };
  };
  gas: string;
  deposit: string;
};

export type SweepPlanRejection =
  | "invalid_request"
  | "unknown_provider"
  | "unsupported_network"
  | "unsupported_destination"
  | "invalid_destination"
  | "below_minimum"
  | "daily_cap_reached"
  | "balance_unavailable"
  | "insufficient_balance"
  | "chain_unavailable"
  | "quote_unavailable"
  | "quote_refused";

/**
 * The 1Click quote of a planned `cross_chain` or `intents` Sweep, for the
 * Provider to check before signing. Amounts are USDC base units: the
 * Provider sends `amountIn` to 1Click's `depositAddress`, and the
 * destination receives about `amountOut`, at least `minAmountOut`. `fee` is
 * what 1Click keeps (`amountIn - amountOut`), `refundFee` what it keeps if
 * it refunds instead. `minimum` is the least Herald Sweeps from the source
 * network, 1Click's minimum deposit there. `timeEstimateSeconds` counts
 * from the transfer's confirmation. The quote must be signed before
 * `signBy`; after that, ask for a fresh one.
 */
export type SweepQuote = {
  depositAddress: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  fee: string;
  refundFee: string;
  minimum: string;
  timeEstimateSeconds: number;
  signBy: Date;
};

export type SweepPlan =
  | { ok: true; sweep: Sweep; signRequest: MpcSignRequest; quote: SweepQuote | null }
  | { ok: false; reason: SweepPlanRejection; message: string };

const SweepPlanInputSchema = z.object({
  network: z.string(),
  amount: z.string().regex(/^\d+$/, "The amount must be a whole number of USDC base units"),
  destinationKind: SweepDestinationKindSchema.default("same_chain"),
  destinationNetwork: z.string().optional(),
  destination: z.string().optional(),
});

/**
 * Where a planned Sweep goes: an address on the source network
 * (`same_chain`, the default), an address on another network
 * (`cross_chain`), or the Provider Account's NEAR Intents account
 * (`intents`).
 */
export type SweepTarget =
  | { destinationKind?: "same_chain"; destination: string }
  | { destinationKind: "cross_chain"; destinationNetwork: string; destination: string }
  | { destinationKind: "intents" };

/**
 * What planning a Sweep reads: D1, balances, for Solana and NEAR the chain
 * and Herald's chain queue (its fee payer or relayer), and 1Click for
 * `cross_chain` and `intents` Sweeps.
 */
export type SweepPlanDeps = {
  db: Db;
  readUsdcBalance: UsdcBalanceReader;
  readSolana: SolanaSweepReader;
  solanaQueue: Pick<SolanaSweepQueue, "feePayer">;
  readNear: NearSweepReader;
  nearQueue: Pick<NearSweepQueue, "relayer">;
  oneClick: Pick<OneClickClient, "quote">;
};

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
 * Plans a Sweep of `amount` USDC (base units) from a Provider's Receiving
 * Address on `network`, and records it as `planned`. `signRequest` is the
 * NEAR call that has the MPC signer sign it for the Receiving Address. `now`
 * defaults to the current time.
 *
 * Where it goes (`SweepTarget`):
 *
 * - `same_chain`: the transfer goes to `destination` on `network`.
 * - `cross_chain`: USDC goes to `destination` on `destinationNetwork`.
 * - `intents`: USDC is credited to the Provider Account inside NEAR
 *   Intents, as the source network's USDC token.
 *
 * For the two 1Click kinds (mainnet only), Herald gets a live 1Click quote
 * with refunds to the source Receiving Address, the transfer goes to the
 * quote's deposit address, and `quote` says what the Provider gets. It must
 * be signed `ONE_CLICK_DEPOSIT_MARGIN_SECONDS` before the quote's deadline
 * at the latest.
 *
 * The transfer:
 *
 * - EVM: an EIP-3009 `transferWithAuthorization` valid for
 *   `SWEEP_VALIDITY_SECONDS`; the MPC signer signs its EIP-712 hash.
 * - Solana: an SPL `TransferChecked` between the USDC token accounts, with
 *   Herald's Solana gas wallet as fee payer, creating the recipient's
 *   token account first (Herald paying the rent) if it has none. It uses a
 *   recent blockhash, so it must be signed within about
 *   `SOLANA_SWEEP_VALIDITY_SECONDS`; the MPC signer signs its message.
 * - NEAR: a NEP-366 delegate action from the NEAR Receiving Address
 *   holding one USDC `ft_transfer`, for Herald's relayer to submit (paying
 *   the gas), to an account registered on USDC. It must be signed within
 *   `NEAR_SWEEP_VALIDITY_SECONDS`, and lands up to a block height a little
 *   past that; the MPC signer signs its NEP-461 hash.
 */
export async function planSweep(
  deps: SweepPlanDeps,
  input: {
    providerId: number;
    env: HeraldEnv;
    network: string;
    amount: string;
    now?: Date;
  } & SweepTarget,
): Promise<SweepPlan> {
  const parsed = SweepPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    return reject("invalid_request", parsed.error.issues[0]?.message ?? "Invalid Sweep.");
  }
  const { amount } = parsed.data;
  const network = networkRegistry[input.env].find((n) => n.caip2 === parsed.data.network);
  if (!network) {
    return reject(
      "unsupported_network",
      `${parsed.data.network} is not a network Herald lists on ${input.env}.`,
    );
  }
  const [row] = await deps.db.select().from(providers).where(eq(providers.id, input.providerId));
  if (!row) return reject("unknown_provider", "No Provider has this id.");
  const provider = await providerFromRow(deps.db, row, input.env);

  const target = resolveTarget(parsed.data, { provider, network, env: input.env });
  if (!target.ok) return target;

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

  // A transfer of more than the balance would fail, with Herald paying the
  // fee.
  const owner = receivingAddressOn(provider, network);
  let balance: string;
  try {
    balance = await deps.readUsdcBalance({ network, owner });
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

  let quote: OneClickQuote | null = null;
  let signBy: number | undefined;
  if (target.kind !== "same_chain") {
    const quoted = await requestQuote(deps, { provider, network, amount, target, now });
    if (!quoted.ok) return quoted;
    ({ quote, signBy } = quoted);
  }
  // Where the transfer goes: the destination itself, or 1Click's deposit address.
  const recipient = quote?.depositAddress ?? target.address;

  const context = {
    provider,
    network,
    amount,
    destination: recipient,
    oneClickDeposit: quote !== null,
    now,
    signBy,
  };
  const plan = await planColumns(deps, { ...context, network });
  if (!plan.ok) return plan;

  const [inserted] = await deps.db
    .insert(sweeps)
    .values({
      providerId: provider.id,
      sourceNetwork: network.caip2,
      asset: network.usdc.address,
      amount,
      destinationKind: target.kind,
      destinationNetwork: target.network,
      destinationAddress: target.address,
      status: "planned",
      createdAt: now,
      updatedAt: now,
      ...plan.row,
      ...(quote && target.kind !== "same_chain"
        ? {
            destinationAsset: target.destinationAsset,
            oneClickQuoteId: quote.quoteId,
            oneClickDepositAddress: quote.depositAddress,
            oneClickSignature: quote.signature,
            quoteAmountOut: quote.amountOut,
            quoteMinAmountOut: quote.minAmountOut,
            quoteRefundFee: quote.refundFee,
            quoteTimeEstimate: Math.ceil(quote.timeEstimate),
            quoteDeadline: quote.deadline,
          }
        : {}),
    })
    .returning();
  const sweep = SweepSchema.parse(inserted);
  return {
    ok: true,
    sweep,
    signRequest: signRequestFor(input.env, sweep),
    quote: quote && {
      depositAddress: quote.depositAddress,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      // Both sides are USDC with 6 decimals.
      fee:
        BigInt(quote.amountOut) < BigInt(amount)
          ? String(BigInt(amount) - BigInt(quote.amountOut))
          : "0",
      refundFee: quote.refundFee,
      minimum: minimum.minimum,
      timeEstimateSeconds: Math.ceil(quote.timeEstimate),
      signBy: new Date(sweep.validBefore * 1000),
    },
  };
}

/**
 * Where a planned Sweep's funds end up: an address on `network` (the
 * source network for `same_chain`), or for `intents` the Provider Account
 * inside NEAR Intents. The 1Click kinds carry 1Click's asset ids.
 */
type ResolvedTarget =
  | { kind: "same_chain"; network: Caip2; address: string }
  | {
      kind: "cross_chain";
      network: Caip2;
      address: string;
      label: string;
      originAsset: string;
      destinationAsset: string;
    }
  | {
      kind: "intents";
      network: Caip2;
      address: string;
      label: string;
      originAsset: string;
      destinationAsset: string;
    };

type OneClickTarget = Exclude<ResolvedTarget, { kind: "same_chain" }>;

function enterAddress(network: Network): string {
  switch (network.kind) {
    case "evm":
      return "Enter an EVM address: 0x and 40 hex characters.";
    case "solana":
      return "Enter a Solana wallet address.";
    case "near":
      return "Enter a NEAR account id, such as alice.near, or a 64-character implicit account.";
    default:
      return unhandledKind(network);
  }
}

/** Checks where a Sweep goes, or says why it can't go there. */
function resolveTarget(
  input: z.infer<typeof SweepPlanInputSchema>,
  { provider, network, env }: { provider: Provider; network: Network; env: HeraldEnv },
): ({ ok: true } & ResolvedTarget) | { ok: false; reason: SweepPlanRejection; message: string } {
  if (input.destinationKind === "same_chain") {
    const address = parseDestination(input.destination?.trim() ?? "", network);
    if (!address) return reject("invalid_request", enterAddress(network));
    if (sameAddress(network.kind, address, receivingAddressOn(provider, network))) {
      return reject(
        "invalid_destination",
        "That's your Receiving Address. Sweep to another address.",
      );
    }
    const lost = lostDestination(address, network);
    if (lost) return reject("invalid_destination", lost);
    return { ok: true, kind: "same_chain", network: network.caip2, address };
  }

  // 1Click's asset ids are mainnet ones, so on testnet there are none.
  const originAsset = oneClickUsdcAsset(network.caip2);
  if (env !== "mainnet" || !originAsset) {
    return reject(
      "unsupported_destination",
      env !== "mainnet"
        ? "1Click runs on mainnet only, so Herald Sweeps across chains and into NEAR Intents on mainnet only."
        : `1Click doesn't take USDC from ${network.label}.`,
    );
  }

  if (input.destinationKind === "intents") {
    return {
      ok: true,
      kind: "intents",
      network: NEAR_INTENTS_NETWORK,
      address: provider.accountId,
      label: "NEAR Intents",
      originAsset,
      destinationAsset: originAsset,
    };
  }

  if (!input.destinationNetwork) return reject("invalid_request", "Choose the chain to Sweep to.");
  const destinationNetwork = networkRegistry[env].find((n) => n.caip2 === input.destinationNetwork);
  if (!destinationNetwork) {
    return reject(
      "unsupported_network",
      `${input.destinationNetwork} is not a network Herald lists on ${env}.`,
    );
  }
  if (destinationNetwork.caip2 === network.caip2) {
    return reject(
      "invalid_destination",
      `That's the chain you Sweep from. Sweep on ${network.label} itself instead.`,
    );
  }
  const destinationAsset = oneClickUsdcAsset(destinationNetwork.caip2);
  if (!destinationAsset) {
    return reject(
      "unsupported_destination",
      `1Click doesn't deliver USDC to ${destinationNetwork.label}.`,
    );
  }
  const address = parseDestination(input.destination?.trim() ?? "", destinationNetwork);
  if (!address) return reject("invalid_request", enterAddress(destinationNetwork));
  // A Receiving Address on another chain is fine: that's consolidating.
  const lost = lostDestination(address, destinationNetwork);
  if (lost) return reject("invalid_destination", lost);
  return {
    ok: true,
    kind: "cross_chain",
    network: destinationNetwork.caip2,
    address,
    label: destinationNetwork.label,
    originAsset,
    destinationAsset,
  };
}

/**
 * Asks 1Click for a live quote of a `cross_chain` or `intents` Sweep, with
 * refunds to the source Receiving Address, and checks it: it must take
 * exactly `amount`, to a deposit address on the source network that isn't
 * one to lose USDC at. `signBy` (Unix seconds) is when the transfer must be
 * signed by, `ONE_CLICK_DEPOSIT_MARGIN_SECONDS` before the quote's deadline
 * and no later than its deposit address goes cold.
 */
async function requestQuote(
  deps: Pick<SweepPlanDeps, "oneClick">,
  {
    provider,
    network,
    amount,
    target,
    now,
  }: { provider: Provider; network: Network; amount: string; target: OneClickTarget; now: Date },
): Promise<
  | { ok: true; quote: OneClickQuote; signBy: number }
  | { ok: false; reason: SweepPlanRejection; message: string }
> {
  const log = (event: string, details: Record<string, unknown>) =>
    console.warn(
      JSON.stringify({ event, providerId: provider.id, network: network.caip2, ...details }),
    );
  let result;
  try {
    result = await deps.oneClick.quote({
      originAsset: target.originAsset,
      destinationAsset: target.destinationAsset,
      amount,
      refundTo: receivingAddressOn(provider, network),
      recipient: target.address,
      recipientType: target.kind === "intents" ? "INTENTS" : "DESTINATION_CHAIN",
      slippageTolerance: ONE_CLICK_SLIPPAGE_BPS,
      deadline: new Date(now.getTime() + ONE_CLICK_DEADLINE_SECONDS * 1000),
    });
  } catch (error) {
    log("sweep_quote_failed", { error: String(error) });
    return reject("quote_unavailable", "Herald couldn't get a quote from 1Click. Try again later.");
  }
  if (!result.ok) {
    log("sweep_quote_refused", { reason: result.reason, message: result.message });
    if (result.reason === "below_minimum") {
      return reject(
        "below_minimum",
        result.minimum
          ? `1Click's minimum from ${network.label} to ${target.label} is ${formatUsdc(result.minimum)} USDC.`
          : `1Click says the amount is too low from ${network.label} to ${target.label}.`,
      );
    }
    return reject("quote_refused", `1Click refused the quote: ${result.message}`);
  }

  const { quote } = result;
  const depositAddress = parseDestination(quote.depositAddress, network);
  const unusable =
    quote.amountIn !== amount
      ? `it quoted ${formatUsdc(quote.amountIn)} USDC instead of ${formatUsdc(amount)}`
      : !depositAddress ||
          sameAddress(network.kind, depositAddress, receivingAddressOn(provider, network)) ||
          lostDestination(depositAddress, network)
        ? `its deposit address ${quote.depositAddress} isn't one Herald can send to on ${network.label}`
        : null;
  if (unusable || !depositAddress) {
    log("sweep_quote_unusable", { quoteId: quote.quoteId, problem: unusable });
    return reject("quote_refused", `Herald can't use 1Click's quote: ${unusable}.`);
  }

  const refundFee = BigInt(quote.refundFee);
  if (refundFee * 100n > BigInt(amount) * MAX_REFUND_FEE_PERCENT) {
    // The least amount whose refund fee is within the limit, rounded up.
    const least = (refundFee * 100n + MAX_REFUND_FEE_PERCENT - 1n) / MAX_REFUND_FEE_PERCENT;
    log("sweep_quote_refund_fee_too_high", { quoteId: quote.quoteId, refundFee: quote.refundFee });
    return reject(
      "below_minimum",
      `If 1Click refunds a Sweep from ${network.label} to ${target.label}, it keeps up to ${formatUsdc(quote.refundFee)} USDC. Sweep at least ${formatUsdc(String(least))} USDC so a refund costs no more than ${MAX_REFUND_FEE_PERCENT}%.`,
    );
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const deadline = Math.floor(quote.deadline.getTime() / 1000);
  const inactiveAt = quote.timeWhenInactive
    ? Math.floor(quote.timeWhenInactive.getTime() / 1000)
    : Infinity;
  const signBy = Math.min(deadline - ONE_CLICK_DEPOSIT_MARGIN_SECONDS, inactiveAt);
  if (signBy - nowSeconds < MIN_QUOTE_SIGNING_SECONDS) {
    log("sweep_quote_too_short", { quoteId: quote.quoteId, deadline: quote.deadline });
    return reject(
      "quote_unavailable",
      "1Click's quote expires too soon to sign. Ask for a fresh one.",
    );
  }
  return { ok: true, quote: { ...quote, depositAddress }, signBy };
}

/** A Sweep's chain-specific columns, as planning fills them in. */
type PlannedColumns =
  | {
      sourceKind: "evm";
      authorizationNonce: Hex;
      validAfter: number;
      validBefore: number;
      payloadHash: Hex;
    }
  | {
      sourceKind: "solana";
      solanaTransaction: string;
      lastValidBlockHeight: number;
      validBefore: number;
    }
  | {
      sourceKind: "near";
      nearDelegateAction: string;
      nearNonce: number;
      nearMaxBlockHeight: number;
      payloadHash: Hex;
      validBefore: number;
    };

type PlannedRow =
  | { ok: true; row: PlannedColumns }
  | { ok: false; reason: SweepPlanRejection; message: string };

type PlanContext<N extends Network> = {
  provider: Provider;
  network: N;
  amount: string;
  /** Who the transfer pays: the destination, or 1Click's deposit address. */
  destination: string;
  /** Whether `destination` is 1Click's deposit address. */
  oneClickDeposit: boolean;
  now: Date;
  /** Unix seconds: the transfer must expire by then (a 1Click quote's signing limit). */
  signBy?: number;
};

/** Plans the chain-specific columns of a Sweep from `network`. */
async function planColumns(
  deps: SweepPlanDeps,
  context: PlanContext<Network>,
): Promise<PlannedRow> {
  const { network } = context;
  switch (network.kind) {
    case "evm":
      return planEvmColumns({ ...context, network });
    case "solana":
      return planSolanaColumns(deps, { ...context, network });
    case "near":
      return planNearColumns(deps, { ...context, network });
    default:
      return unhandledKind(network);
  }
}

function planEvmColumns({
  provider,
  network,
  amount,
  destination,
  now,
  signBy = Infinity,
}: PlanContext<EvmNetwork>): PlannedRow {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const validAfter = nowSeconds - VALID_AFTER_SKEW_SECONDS;
  const validBefore = Math.min(nowSeconds + SWEEP_VALIDITY_SECONDS, signBy);
  const { nonce, hash } = authorizationPayload(network, {
    from: provider.evmAddress,
    to: destination,
    value: BigInt(amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
  });
  return {
    ok: true,
    row: {
      sourceKind: "evm",
      authorizationNonce: nonce,
      validAfter,
      validBefore,
      payloadHash: hash,
    },
  };
}

/**
 * Reads what the Solana transaction needs (Herald's fee payer, whether the
 * destination is a wallet and has a USDC token account, a recent blockhash)
 * and builds it.
 */
async function planSolanaColumns(
  deps: Pick<SweepPlanDeps, "readSolana" | "solanaQueue">,
  { provider, network, amount, destination, now, signBy = Infinity }: PlanContext<SolanaNetwork>,
): Promise<PlannedRow> {
  let feePayer: string;
  let destinationOwner: string | null;
  let tokenAccountExists: boolean;
  try {
    const destinationTokenAccount = await usdcTokenAccount(destination, network.usdc.address);
    [feePayer, destinationOwner, tokenAccountExists] = await Promise.all([
      deps.solanaQueue.feePayer(network.caip2),
      deps.readSolana.accountOwner({ network, account: destination }),
      deps.readSolana
        .accountOwner({ network, account: destinationTokenAccount })
        .then((owner) => owner !== null),
    ]);
  } catch (error) {
    return chainUnavailable(provider, network, error);
  }
  if (destination === feePayer) {
    return reject(
      "invalid_destination",
      `That's Herald's fee payer on ${network.label}. Sweep to an address you control.`,
    );
  }
  // USDC sent to a token account's own token account can't be moved again.
  if (
    destinationOwner === TOKEN_PROGRAM_ADDRESS ||
    destinationOwner === TOKEN_2022_PROGRAM_ADDRESS
  ) {
    return reject(
      "invalid_destination",
      `${destination} is a token account or mint, not a wallet. Enter the wallet address that should receive the USDC.`,
    );
  }

  // Read last, so the transaction has as much of its blockhash's lifetime
  // left as possible.
  let blockhash: { blockhash: string; lastValidBlockHeight: number };
  try {
    blockhash = await deps.readSolana.latestBlockhash({ network });
  } catch (error) {
    return chainUnavailable(provider, network, error);
  }
  const solanaTransaction = await buildSolanaSweepTransaction({
    feePayer,
    owner: provider.solanaAddress,
    destination,
    mint: network.usdc.address,
    decimals: network.usdc.decimals,
    amount: BigInt(amount),
    createTokenAccount: !tokenAccountExists,
    ...blockhash,
  });
  return {
    ok: true,
    row: {
      sourceKind: "solana",
      solanaTransaction,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      validBefore: Math.min(
        Math.floor(now.getTime() / 1000) + SOLANA_SWEEP_VALIDITY_SECONDS,
        signBy,
      ),
    },
  };
}

/**
 * Reads what the delegate action needs (Herald's relayer, the NEAR
 * Receiving Address's key nonce, whether the destination can receive USDC,
 * the final block height) and builds it. Its nonce is above the key's and
 * above any NEAR Sweep of the Provider's still on its way, so Sweeps
 * planned one after the other can all land in that order.
 *
 * 1Click's deposit address on NEAR is a fresh implicit account that isn't
 * registered on USDC, so it isn't refused for that: Herald's relayer
 * registers it when it submits the Sweep (see `NearChainQueueRpc.submitSweep`).
 * For a 1Click Sweep, the delegate action's `nearMaxBlockHeight` follows
 * from the quote's signing limit (`signBy`), as `validBefore` does.
 */
async function planNearColumns(
  deps: Pick<SweepPlanDeps, "db" | "readNear" | "nearQueue">,
  {
    provider,
    network,
    amount,
    destination,
    oneClickDeposit,
    now,
    signBy = Infinity,
  }: PlanContext<NearNetwork>,
): Promise<PlannedRow> {
  const publicKey = hexToBytes(provider.nearAddress);
  let relayer: string;
  let keyNonce: bigint | null;
  let canReceive: boolean;
  try {
    [relayer, keyNonce, canReceive] = await Promise.all([
      deps.nearQueue.relayer(network.caip2),
      deps.readNear.accessKeyNonce({ network, accountId: provider.nearAddress, publicKey }),
      // 1Click's deposit address isn't registered on USDC yet: the relayer
      // registers it when it submits the Sweep.
      oneClickDeposit ? true : deps.readNear.storageRegistered({ network, accountId: destination }),
    ]);
  } catch (error) {
    return chainUnavailable(provider, network, error);
  }
  if (destination === relayer) {
    return reject(
      "invalid_destination",
      `That's Herald's relayer on ${network.label}. Sweep to an account you control.`,
    );
  }
  // An ft_transfer to an unregistered account fails, with Herald paying the gas.
  if (!canReceive) {
    return reject(
      "invalid_destination",
      `${destination} isn't registered on USDC on ${network.label}, so it can't receive USDC. Its owner registers it first (USDC's storage_deposit), as NEAR wallets do.`,
    );
  }
  if (keyNonce === null) {
    return reject(
      "chain_unavailable",
      `Your NEAR Receiving Address isn't set up on ${network.label} yet. Herald sets it up when you sign in; try again in a few minutes.`,
    );
  }
  const [open] = await deps.db
    .select({ nonce: max(sweeps.nearNonce) })
    .from(sweeps)
    .where(
      and(
        eq(sweeps.providerId, provider.id),
        eq(sweeps.sourceNetwork, network.caip2),
        inArray(sweeps.status, ["planned", "awaiting_signature", "submitted"]),
      ),
    );
  const lastPlanned = open?.nonce != null ? BigInt(open.nonce) : 0n;
  const nonce = (keyNonce > lastPlanned ? keyNonce : lastPlanned) + 1n;

  // Read last, so the delegate action has as much of its window left as
  // possible.
  let height: number;
  try {
    height = await deps.readNear.finalBlockHeight({ network });
  } catch (error) {
    return chainUnavailable(provider, network, error);
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const validBefore = Math.min(nowSeconds + NEAR_SWEEP_VALIDITY_SECONDS, signBy);
  const maxBlockHeight =
    height + Math.ceil(((validBefore - nowSeconds) * 1000) / NEAR_FASTEST_BLOCK_MS);
  const delegateAction = nearSweepDelegateAction({
    senderId: provider.nearAddress,
    usdc: network.usdc.address,
    receiverId: destination,
    amount,
    nonce,
    maxBlockHeight: BigInt(maxBlockHeight),
    publicKey,
  });
  return {
    ok: true,
    row: {
      sourceKind: "near",
      nearDelegateAction: base64.encode(delegateAction),
      nearNonce: Number(nonce),
      nearMaxBlockHeight: maxBlockHeight,
      payloadHash: bytesToHex(nearDelegatePayloadHash(delegateAction)),
      validBefore,
    },
  };
}

function chainUnavailable(provider: Provider, network: Network, error: unknown): PlannedRow {
  console.warn(
    JSON.stringify({
      event: "sweep_chain_read_failed",
      providerId: provider.id,
      network: network.caip2,
      error: String(error),
    }),
  );
  return reject(
    "chain_unavailable",
    `Herald couldn't reach ${network.label} to plan the Sweep. Try again later.`,
  );
}

/**
 * `destination` as an address on `network`'s chain, or null if it isn't
 * one: 0x and 40 hex characters on EVM, a base58 32-byte key on Solana, a
 * NEAR account id on NEAR.
 */
function parseDestination(destination: string, network: Network): string | null {
  switch (network.kind) {
    case "evm":
      return EvmAddressSchema.safeParse(destination).success ? destination : null;
    case "solana":
      return isAddress(destination) ? destination : null;
    case "near":
      return NearAccountIdSchema.safeParse(destination).success ? destination : null;
    default:
      return unhandledKind(network);
  }
}

/**
 * A NEAR transaction as NEAR RPC's `tx` method reports it, the parts Herald
 * reads: who sent it to which contract with which actions, and its final
 * `status`, which is `{ SuccessValue: <base64> }` once it succeeded (for an
 * MPC `sign` call, the signature), `{ Failure: … }` if it failed, or a
 * string such as `"Started"` while it still runs. `receipts_outcome` is
 * each receipt's executor and status: for a sponsored `sign` relayed in a
 * delegate action, the top-level status is the delegate receipt's empty
 * `SuccessValue`, and the signature is the `SuccessValue` of the MPC
 * signer's receipt (#46).
 */
export type NearTransactionOutcome = {
  transaction: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] };
  status: unknown;
  receipts_outcome?: Array<{ outcome?: { executor_id?: string; status?: unknown } }>;
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

  /** The gas wallet's address, which pays for every transaction the queue sends. */
  gasWallet(): Promise<string>;
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
  /** EVM: Herald's chain queue, and transfer receipts. */
  submitSweep: EvmSweepSubmitter;
  readReceipt: EvmReceiptReader;
  /** Solana: the chain, and Herald's chain queue. */
  readSolana: SolanaSweepReader;
  solanaQueue: Pick<SolanaSweepQueue, "submitSweep">;
  /** NEAR: the chain, and Herald's chain queue (which also relays sponsored `sign` calls). */
  readNear: Pick<NearSweepReader, "finalBlockHeight" | "sweepStatus">;
  nearQueue: Pick<NearSweepQueue, "submitSweep" | "submitSponsoredSign">;
  /** `cross_chain` and `intents` Sweeps: 1Click's swap status. */
  oneClick: Pick<OneClickClient, "status">;
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
  const found = await ownSweep(deps.db, input);
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
  // Expired before this signing transaction came in: say why it failed.
  if (sweep.status === "failed" && sweep.nearTxHash === null) return { ok: true, sweep };
  if (sweep.nearTxHash !== nearTxHash) return nearTxMismatch(sweep);
  return {
    ok: true,
    sweep: await advance(deps, { provider, sweep, env: input.env, now: input.now }),
  };
}

export type SponsoredSweepRejection =
  | SweepCompletionRejection
  | "delegate_refused"
  | "daily_cap_reached"
  | "relay_refused"
  | "relay_unanswered";

export type SponsoredSweepRelay =
  | { ok: true; sweep: Sweep }
  | { ok: false; reason: SponsoredSweepRejection; message: string };

/**
 * Takes the signed delegate action (NEP-366, base64 Borsh) in which the
 * Provider's wallet signed a planned Sweep's MPC `sign` call instead of
 * sending it, and has Herald's NEAR relayer send it, paying the gas
 * (ADR 0010). Then carries the Sweep on as `completeSweep` does, with the
 * relayer's transaction as its NEAR signing transaction: the signature is
 * read from the MPC signer's receipt in it.
 *
 * It refuses (`delegate_refused`), relaying nothing, a delegate action whose
 * sender isn't the Provider Account, that doesn't hold exactly one `sign`
 * call to the Herald environment's MPC signer with 1 yoctoNEAR and at most
 * `SPONSORED_SIGN_MAX_GAS`, or whose payload, path and domain aren't the
 * planned Sweep's (`sponsoredSignProblem`). A Sweep already signed isn't
 * relayed again: presenting a delegate action for it again answers where
 * it stands, with the relayer transaction it has. It also refuses
 * (`daily_cap_reached`) when the Provider's Sweeps submitted in the last
 * 24 hours and those still awaiting their signature reach
 * `SWEEP_DAILY_CAP`, since Herald pays for each `sign` it relays.
 *
 * Herald relays one delegate action per Sweep (ADR 0008), whoever presents
 * another: the first one presented is taken for the Sweep before it is
 * relayed (`takeSponsoredApproval`). Another one presented for it, at the
 * same time (two tabs) or after the relayer went unanswered (a re-sign),
 * sends that first one again, which the queue sends at most once, and
 * answers the same as it does.
 *
 * `relay_refused` is the NEAR chain queue's own refusal (it checks the
 * delegate action again, and whether it can land), after which a new
 * delegate action for the Sweep can be relayed; `relay_unanswered` means
 * the queue couldn't be reached, and presenting the same signed delegate
 * action again is safe: the queue sends it at most once. Either way the
 * Sweep stays `planned`. `now` defaults to the current time.
 */
export async function relaySponsoredSweep(
  deps: SweepDeps,
  input: {
    providerId: number;
    env: HeraldEnv;
    sweepId: number;
    signedDelegateAction: string;
    now?: Date;
  },
): Promise<SponsoredSweepRelay> {
  const found = await ownSweep(deps.db, input);
  if (!found) return { ok: false, reason: "unknown_sweep", message: "No such Sweep." };
  const { provider } = found;
  let { sweep } = found;
  const context = { provider, env: input.env, now: input.now };

  const problem = sponsoredSignProblem(input.env, provider, sweep, input.signedDelegateAction);
  if (problem) return { ok: false, reason: "delegate_refused", message: problem };

  if (sweep.status !== "planned") return answerSignedSweep(deps, { ...context, sweep });
  const now = input.now ?? new Date();
  if (Math.floor(now.getTime() / 1000) >= sweep.validBefore) {
    // Too late to sign: fail it rather than pay for a signature of it.
    return { ok: true, sweep: await advance(deps, { ...context, sweep }) };
  }
  if (await sponsoredCapReached(deps.db, provider.id, now)) {
    return { ok: false, reason: "daily_cap_reached", message: dailyCapMessage };
  }
  const approval = await takeSponsoredApproval(deps.db, sweep.id, input.signedDelegateAction);
  if (approval === null) {
    // Another approval was recorded since the Sweep was read.
    return answerSignedSweep(deps, { ...context, sweep: await readSweep(deps.db, sweep.id) });
  }

  const mpcNetwork = nearNetworkOf(input.env);
  let relayed: NearSponsoredSignResult;
  try {
    relayed = await deps.nearQueue.submitSponsoredSign({
      network: mpcNetwork.caip2,
      signedDelegateAction: approval,
    });
  } catch (error) {
    logSweep("sweep_sponsored_sign_unanswered", sweep, { error: String(error) }, "warn");
    return {
      ok: false,
      reason: "relay_unanswered",
      message: "Herald's NEAR relayer didn't answer. Try again.",
    };
  }
  if (!relayed.ok) {
    logSweep("sweep_sponsored_sign_refused", sweep, { message: relayed.message }, "warn");
    // The relayer sent nothing: a new approval for the Sweep may go.
    await deps.db
      .update(sweeps)
      .set({ sponsoredDelegateAction: null, updatedAt: new Date() })
      .where(
        and(
          eq(sweeps.id, sweep.id),
          eq(sweeps.status, "planned"),
          eq(sweeps.sponsoredDelegateAction, approval),
        ),
      );
    return {
      ok: false,
      reason: "relay_refused",
      message: `Herald's NEAR relayer didn't send your approval: ${relayed.message}`,
    };
  }
  logSweep("sweep_sponsored_sign_relayed", sweep, {
    nearTxHash: relayed.transaction,
    relayer: relayed.relayer,
  });

  try {
    await deps.db
      .update(sweeps)
      .set({
        status: "awaiting_signature",
        nearTxHash: relayed.transaction,
        nearTxRelayer: relayed.relayer,
        updatedAt: new Date(),
      })
      .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "planned")));
  } catch (error) {
    // `near_tx_hash` is unique: no other Sweep can hold a fresh relayer
    // transaction, unless the same delegate action was relayed for it.
    logSweep("sweep_near_tx_conflict", sweep, { error: String(error) }, "warn");
    return {
      ok: false,
      reason: "near_tx_mismatch",
      message: `NEAR transaction ${relayed.transaction} belongs to another Sweep.`,
    };
  }
  sweep = await readSweep(deps.db, sweep.id);
  // Another approval for this Sweep was recorded first.
  if (sweep.nearTxHash !== relayed.transaction) return nearTxMismatch(sweep);
  return { ok: true, sweep: await advance(deps, { ...context, sweep }) };
}

/**
 * Answers a sponsored approval presented for a Sweep that isn't `planned`
 * any more, relaying nothing: where it stands if Herald's relayer sent its
 * approval, why it failed if it expired unsigned, and `near_tx_mismatch`
 * if the Provider's wallet sent it.
 */
async function answerSignedSweep(
  deps: SweepDeps,
  context: SweepContext,
): Promise<SponsoredSweepRelay> {
  const { sweep } = context;
  if (sweep.nearTxRelayer !== null) return { ok: true, sweep: await advance(deps, context) };
  if (sweep.status === "failed" && sweep.nearTxHash === null) return { ok: true, sweep };
  return nearTxMismatch(sweep);
}

/**
 * Takes `signedDelegateAction` as the one approval Herald's relayer sends
 * for the planned Sweep `sweepId`, unless it already has one, and answers
 * the Sweep's approval: this one, or the one presented first. Null if the
 * Sweep isn't `planned` any more.
 */
async function takeSponsoredApproval(
  db: Db,
  sweepId: number,
  signedDelegateAction: string,
): Promise<string | null> {
  await db
    .update(sweeps)
    .set({ sponsoredDelegateAction: signedDelegateAction, updatedAt: new Date() })
    .where(
      and(
        eq(sweeps.id, sweepId),
        eq(sweeps.status, "planned"),
        isNull(sweeps.sponsoredDelegateAction),
      ),
    );
  const [row] = await db
    .select({ status: sweeps.status, approval: sweeps.sponsoredDelegateAction })
    .from(sweeps)
    .where(eq(sweeps.id, sweepId));
  return row?.status === "planned" ? row.approval : null;
}

/** A Sweep whose NEAR signing transaction isn't the one presented for it. */
function nearTxMismatch(sweep: Sweep): {
  ok: false;
  reason: "near_tx_mismatch";
  message: string;
} {
  return {
    ok: false,
    reason: "near_tx_mismatch",
    message: `This Sweep belongs to NEAR transaction ${sweep.nearTxHash ?? "(none)"}.`,
  };
}

export type SponsoredAccountRejection =
  | "unknown_sweep"
  | "sweep_not_signable"
  | "daily_cap_reached"
  | "account_refused"
  | "account_unanswered";

/**
 * The Provider Account is on NEAR, ready for the wallet to sign a sponsored
 * Sweep: `transaction` is the relayer transaction in which Herald created
 * it, now or for an earlier Sweep, or null if Herald didn't (a named
 * account, or an implicit one already on NEAR).
 */
export type SponsoredAccountPreparation =
  | { ok: true; transaction: string | null }
  | { ok: false; reason: SponsoredAccountRejection; message: string };

/** What preparing a Provider Account reads and writes: D1, and Herald's NEAR chain queue. */
export type SponsoredAccountDeps = {
  db: Db;
  nearQueue: Pick<NearSweepQueue, "createProviderAccount">;
};

/**
 * Makes sure the Provider Account is on NEAR before its wallet signs a
 * sponsored Sweep's delegate action (ADR 0010, #50), which can only land
 * with the account's key on chain. An implicit Provider Account nobody
 * funded has none: Herald's NEAR relayer creates it by sending it a little
 * NEAR, as for a NEAR Receiving Address, and this answers once that is
 * final. NEAR creates it with the full-access key its id encodes, the
 * wallet's, so Herald gains no control over it. Call it once before the
 * wallet prompt, for one Sweep or a "Sweep all" batch (any one of its
 * planned Sweeps).
 *
 * Herald creates the account only if `sweepId` is the Provider's planned
 * Sweep (so it passed the minimum) still inside its signing window, the
 * daily cap leaves room for it as `relaySponsoredSweep` counts it, the
 * Provider Account is implicit, Herald never created it before (the
 * Provider's `providerAccountTxHash`, then the NEAR chain queue's own
 * record), and it isn't on NEAR (the queue reads it). The queue creates
 * each account at most once, whatever the concurrent Sweeps or retries.
 * Signing in never calls this.
 *
 * `sweep_not_signable` is a Sweep already approved, failed or past its
 * signing window. `account_refused` is the queue's answer when the
 * creation failed or wasn't final in time, and `account_unanswered` means
 * the queue couldn't be reached: either way the Sweep stays `planned`, and
 * asking again is safe. `now` defaults to the current time.
 */
export async function prepareSponsoredSweepAccount(
  deps: SponsoredAccountDeps,
  input: { providerId: number; env: HeraldEnv; sweepId: number; now?: Date },
): Promise<SponsoredAccountPreparation> {
  const found = await ownSweep(deps.db, input);
  if (!found) return { ok: false, reason: "unknown_sweep", message: "No such Sweep." };
  const { provider, sweep } = found;
  const now = input.now ?? new Date();
  if (sweep.status !== "planned" || Math.floor(now.getTime() / 1000) >= sweep.validBefore) {
    return {
      ok: false,
      reason: "sweep_not_signable",
      message: "This Sweep can't be approved any more. Start a new one.",
    };
  }
  const account = NearImplicitAccountSchema.safeParse(provider.accountId);
  // Named accounts are on NEAR before anyone signs in with them.
  if (!account.success) return { ok: true, transaction: null };
  if (provider.providerAccountTxHash !== null) {
    return { ok: true, transaction: provider.providerAccountTxHash };
  }
  if (await sponsoredCapReached(deps.db, provider.id, now)) {
    return { ok: false, reason: "daily_cap_reached", message: dailyCapMessage };
  }

  const network = nearNetworkOf(input.env);
  let created: NearProviderAccountResult;
  try {
    created = await deps.nearQueue.createProviderAccount({
      network: network.caip2,
      providerId: provider.id,
      account: account.data,
    });
  } catch (error) {
    logSweep("sweep_provider_account_unanswered", sweep, { error: String(error) }, "warn");
    return {
      ok: false,
      reason: "account_unanswered",
      message:
        "Herald's NEAR relayer didn't answer while preparing your Provider Account. Try again.",
    };
  }
  if (!created.ok) {
    logSweep("sweep_provider_account_refused", sweep, { message: created.message }, "warn");
    return {
      ok: false,
      reason: "account_refused",
      message: `Herald couldn't prepare your Provider Account ${provider.accountId}: ${created.message}. Try again.`,
    };
  }
  if (created.transaction !== null) {
    await deps.db
      .update(providers)
      .set({ providerAccountTxHash: created.transaction })
      .where(and(eq(providers.id, provider.id), isNull(providers.providerAccountTxHash)));
    logSweep("sweep_provider_account_created", sweep, { transaction: created.transaction });
  }
  return { ok: true, transaction: created.transaction };
}

/**
 * Whether the Provider's Sweeps submitted in the last 24 hours and those
 * still awaiting their signature reach `SWEEP_DAILY_CAP`, as
 * `relaySponsoredSweep` counts them before relaying a `sign`.
 */
async function sponsoredCapReached(db: Db, providerId: number, now: Date): Promise<boolean> {
  return (
    (await sweepsSubmittedInLastDay(db, providerId, now)) +
      (await sweepsAwaitingSignature(db, providerId)) >=
    SWEEP_DAILY_CAP
  );
}

/**
 * Why Herald won't relay `signedDelegateAction` as `sweep`'s sponsored MPC
 * `sign` call, or null if it will: it must be a single `sign` call to the
 * environment's MPC signer with 1 yoctoNEAR and capped gas
 * (`readSponsoredSign`), from the Provider Account, asking for exactly the
 * Sweep's `MpcSignRequest`: its payload, path and domain.
 */
function sponsoredSignProblem(
  env: HeraldEnv,
  provider: Provider,
  sweep: Sweep,
  signedDelegateAction: string,
): string | null {
  const read = readSponsoredSign(signedDelegateAction, mpcSigners[env].contractId);
  if (!read.ok) return read.message;
  const { sign } = read;
  if (sign.senderId !== provider.accountId) {
    return `Herald won't relay it: it's from ${sign.senderId}, not your Provider Account ${provider.accountId}.`;
  }
  const planned = signRequestFor(env, sweep).args.request;
  const asked = sign.request;
  if (
    mpcPayloadKey(asked.payload_v2) !== mpcPayloadKey(planned.payload_v2) ||
    asked.path !== planned.path ||
    asked.domain_id !== planned.domain_id
  ) {
    return "Herald won't relay it: it asks the MPC signer for another payload, path or domain than this Sweep's.";
  }
  return null;
}

/** How many of a Provider's Sweeps wait for their MPC signature right now. */
async function sweepsAwaitingSignature(db: Db, providerId: number): Promise<number> {
  const [row] = await db
    .select({ awaiting: count() })
    .from(sweeps)
    .where(and(eq(sweeps.providerId, providerId), eq(sweeps.status, "awaiting_signature")));
  return row?.awaiting ?? 0;
}

/** The Herald environment's NEAR network, where its MPC signer lives. */
function nearNetworkOf(env: HeraldEnv): NearNetwork {
  const network = networkRegistry[env].find((n): n is NearNetwork => n.kind === "near");
  if (!network) throw new Error(`Herald lists no NEAR network on ${env}`);
  return network;
}

/**
 * One chain a Provider can Sweep from: its Receiving Address there (the
 * EVM one on every EVM chain), the USDC balance there (or why it couldn't
 * be read), and the minimum Sweep in base units, null if Herald has none
 * for the chain (it can't Sweep there). `oneClick` says whether 1Click
 * takes and delivers its USDC, for `cross_chain` and `intents` Sweeps
 * (mainnet only). `sweepAll` says whether "Sweep all" takes the chain: it
 * holds at least its minimum (see `planSweepAll`).
 */
export type SweepChainOption = {
  network: Caip2;
  kind: Network["kind"];
  label: string;
  address: string;
  balance: { ok: true; amount: string } | { ok: false; message: string };
  minimum: string | null;
  oneClick: boolean;
  sweepAll: boolean;
};

/** Whether `balance` is worth a Sweep: something, and at least the chain's `minimum` (none: never). */
function holdsMinimum(balance: string, minimum: string | null): boolean {
  return minimum !== null && BigInt(balance) > 0n && BigInt(balance) >= BigInt(minimum);
}

export type SweepOptions = {
  /** The networks of the Herald environment, in Payment Option order. */
  chains: SweepChainOption[];
  /** Sweeps Herald submitted for the Provider in the last 24 hours. */
  submittedToday: number;
  dailyCap: number;
};

/**
 * What a Provider can Sweep now: every chain of `env` with the live
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
    if (!read) continue;
    const minimum = await getSweepMinimum(deps.db, network);
    chains.push({
      network: network.caip2,
      kind: network.kind,
      label: network.label,
      address: read.address,
      balance: read.ok ? { ok: true, amount: read.amount } : { ok: false, message: read.message },
      minimum: minimum?.minimum ?? null,
      oneClick: input.env === "mainnet" && oneClickUsdcAsset(network.caip2) !== undefined,
      sweepAll: read.ok && holdsMinimum(read.amount, minimum?.minimum ?? null),
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
 * One of a Provider's Sweeps with its networks' names and links:
 * `sourceTxUrl` for the transfer, `nearTxUrl` for the NEAR signing
 * transaction, `deliveryTxUrl` for 1Click's delivery on the destination
 * network and `oneClickUrl` for the 1Click swap on the NEAR Intents
 * explorer. Each is null until it exists. `destinationLabel` names where the
 * funds go: the destination network, or NEAR Intents.
 */
export type SweepEntry = Sweep & {
  label: string;
  destinationLabel: string;
  sourceTxUrl: string | null;
  nearTxUrl: string | null;
  deliveryTxUrl: string | null;
  oneClickUrl: string | null;
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
 * - A `cross_chain` or `intents` Sweep that is `confirmed` or `delivering`
 *   reads 1Click's status: `delivering`, then `delivered`, `refunded` or
 *   `failed`.
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
  const provider = await providerFromRow(deps.db, providerRow, input.env);
  const unfinished = await deps.db
    .select()
    .from(sweeps)
    .where(
      and(
        eq(sweeps.providerId, provider.id),
        or(
          inArray(sweeps.status, ["planned", "awaiting_signature", "submitted", "delivering"]),
          // A 1Click Sweep whose transfer landed is still on its way.
          and(eq(sweeps.status, "confirmed"), ne(sweeps.destinationKind, "same_chain")),
        ),
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
    .where(
      and(
        eq(sweeps.providerId, provider.id),
        // A 1Click quote the Provider never sent to the wallet isn't a
        // Sweep they started: leave it out, discarded or expired.
        or(eq(sweeps.destinationKind, "same_chain"), isNotNull(sweeps.nearTxHash)),
      ),
    )
    .orderBy(desc(sweeps.createdAt), desc(sweeps.id))
    .limit(input.limit ?? SWEEP_LIST_LIMIT);
  return latest.map((row) => sweepEntry(input.env, SweepSchema.parse(row)));
}

/**
 * Discards a planned Sweep the Provider decided not to sign, such as a
 * 1Click quote they dropped: it fails, so it can't be completed later, and
 * `refreshSweeps` leaves an unsigned 1Click one out of the list. False if
 * the Provider has no such Sweep still `planned`.
 */
export async function discardSweep(
  db: Db,
  input: { providerId: number; sweepId: number },
): Promise<boolean> {
  const discarded = await db
    .update(sweeps)
    .set({
      status: "failed",
      error: "You discarded this Sweep before signing it.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sweeps.id, input.sweepId),
        eq(sweeps.providerId, input.providerId),
        eq(sweeps.status, "planned"),
      ),
    )
    .returning({ id: sweeps.id });
  return discarded.length > 0;
}

const nearTxExplorers = {
  testnet: "https://testnet.nearblocks.io/txns/",
  mainnet: "https://nearblocks.io/txns/",
} as const satisfies Record<HeraldEnv, string>;

const ONE_CLICK_EXPLORER = "https://explorer.near-intents.org/transactions/";

function sweepEntry(env: HeraldEnv, sweep: Sweep): SweepEntry {
  const network = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  const destination = networkRegistry[env].find((n) => n.caip2 === sweep.destinationNetwork);
  return {
    ...sweep,
    label: network?.label ?? sweep.sourceNetwork,
    destinationLabel:
      sweep.destinationKind === "intents"
        ? "NEAR Intents"
        : (destination?.label ?? sweep.destinationNetwork),
    sourceTxUrl: network && sweep.sourceTxHash ? explorerTxUrl(network, sweep.sourceTxHash) : null,
    nearTxUrl: sweep.nearTxHash
      ? `${nearTxExplorers[env]}${encodeURIComponent(sweep.nearTxHash)}`
      : null,
    deliveryTxUrl:
      sweep.destinationKind === "cross_chain" && destination && sweep.deliveryTxHash
        ? explorerTxUrl(destination, sweep.deliveryTxHash)
        : null,
    oneClickUrl: sweep.oneClickDepositAddress
      ? `${ONE_CLICK_EXPLORER}${encodeURIComponent(sweep.oneClickDepositAddress)}`
      : null,
  };
}

// A transfer without a receipt this long after its authorization expired
// can no longer execute, so the Sweep has failed.
const UNMINED_GRACE_SECONDS = 5 * 60;

type SweepContext<S extends Sweep = Sweep> = {
  provider: Provider;
  sweep: S;
  env: HeraldEnv;
  now?: Date;
};

/** Moves a Sweep on from where it stands, as far as it can go now. */
async function advance(deps: SweepDeps, context: SweepContext): Promise<Sweep> {
  const { sweep } = context;
  const nowSeconds = Math.floor((context.now ?? new Date()).getTime() / 1000);
  switch (sweep.status) {
    case "planned":
      if (nowSeconds < sweep.validBefore) return sweep;
      return fail(deps.db, sweep, `It wasn't signed before its ${expiryOf(sweep)} expired.`);
    case "awaiting_signature": {
      if (nowSeconds >= sweep.validBefore) {
        return fail(
          deps.db,
          sweep,
          `The MPC signature didn't arrive before the ${expiryOf(sweep)} expired. Start a new Sweep.`,
        );
      }
      const signature = await readMpcSignature(deps, context);
      if (signature === "pending") return sweep;
      if (signature.ok === false) return fail(deps.db, sweep, signature.error);
      if (
        (await sweepsSubmittedInLastDay(deps.db, sweep.providerId, context.now ?? new Date())) >=
        SWEEP_DAILY_CAP
      ) {
        return fail(deps.db, sweep, dailyCapMessage);
      }
      switch (sweep.sourceKind) {
        case "evm":
          return submitEvmSweep(deps, { ...context, sweep }, signature.successValue);
        case "solana":
          return submitSolanaSweep(deps, { ...context, sweep }, signature.successValue);
        case "near":
          return submitNearSweep(deps, { ...context, sweep }, signature.successValue);
        default:
          return unhandledKind(sweep);
      }
    }
    case "submitted":
      switch (sweep.sourceKind) {
        case "evm":
          return awaitReceipt(deps, { ...context, sweep }, nowSeconds);
        case "solana":
          return awaitSolanaTransaction(deps, { ...context, sweep });
        case "near":
          return awaitNearTransfer(deps, { ...context, sweep });
        default:
          return unhandledKind(sweep);
      }
    case "confirmed":
    case "delivering":
      return sweep.destinationKind === "same_chain" ? sweep : followOneClick(deps, context);
    default:
      return sweep;
  }
}

/** Who a Sweep's transfer pays: 1Click's deposit address for the 1Click kinds, else the destination. */
function transferRecipient(sweep: Sweep): string {
  return sweep.oneClickDepositAddress ?? sweep.destinationAddress;
}

/** What `validBefore` is the expiry of, for messages. */
function expiryOf(sweep: Sweep): string {
  if (sweep.destinationKind !== "same_chain") return "1Click quote";
  switch (sweep.sourceKind) {
    case "evm":
      return "authorization";
    case "solana":
      return "transaction's blockhash";
    case "near":
      return "delegate action";
    default:
      return unhandledKind(sweep);
  }
}

/**
 * Follows a `cross_chain` or `intents` Sweep whose transfer landed, through
 * 1Click's status for its deposit address: `delivering` once 1Click has the
 * deposit, then `delivered` or `refunded` (to the source Receiving
 * Address), or `failed` if 1Click gave up. A status 1Click can't give yet,
 * or that can't be read, leaves the Sweep as it is, except that a deposit
 * 1Click still hasn't seen `ONE_CLICK_PICKUP_GRACE_SECONDS` after the
 * quote's deadline fails the Sweep: the deposit address is inactive by then.
 */
async function followOneClick(
  deps: SweepDeps,
  { sweep, env, now: at }: SweepContext,
): Promise<Sweep> {
  const depositAddress = sweep.oneClickDepositAddress;
  if (!depositAddress) return sweep;
  let swap: OneClickSwap | null;
  try {
    swap = await deps.oneClick.status(depositAddress);
  } catch (error) {
    logSweep("sweep_one_click_status_failed", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  const now = at ?? new Date();
  // Not seen yet: 1Click picks the deposit up from the chain, until well
  // after the quote's deadline.
  if (!swap || swap.status === "PENDING_DEPOSIT") {
    const deadline = sweep.quoteDeadline?.getTime();
    if (
      sweep.status !== "confirmed" ||
      deadline === undefined ||
      now.getTime() < deadline + ONE_CLICK_PICKUP_GRACE_SECONDS * 1000
    ) {
      return sweep;
    }
    return fail(
      deps.db,
      sweep,
      `1Click didn't pick up the deposit before its quote's deadline. The USDC sits at 1Click's deposit address ${depositAddress}; contact NEAR Intents support with it.`,
    );
  }
  const source = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  const sourceLabel = source?.label ?? sweep.sourceNetwork;
  const guard = and(eq(sweeps.id, sweep.id), eq(sweeps.status, sweep.status));

  switch (swap.status) {
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
    // Below the quote, which Herald's exact transfers never are: 1Click
    // refunds it, and reports `REFUNDED` once it has.
    case "INCOMPLETE_DEPOSIT":
      if (sweep.status === "delivering") return sweep;
      await deps.db.update(sweeps).set({ status: "delivering", updatedAt: now }).where(guard);
      logSweep("sweep_delivering", sweep, { oneClickStatus: swap.status });
      return readSweep(deps.db, sweep.id);
    case "SUCCESS":
      await deps.db
        .update(sweeps)
        .set({
          status: "delivered",
          deliveredAmount: swap.amountOut,
          deliveryTxHash: swap.destinationTxHashes.at(-1) ?? null,
          updatedAt: now,
        })
        .where(guard);
      logSweep("sweep_delivered", sweep, { amountOut: swap.amountOut });
      return readSweep(deps.db, sweep.id);
    case "REFUNDED": {
      const amount = swap.refundedAmount
        ? `${formatUsdc(swap.refundedAmount)} USDC`
        : "the deposit";
      const reason = swap.refundReason ? ` (${swap.refundReason})` : "";
      await deps.db
        .update(sweeps)
        .set({
          status: "refunded",
          refundedAmount: swap.refundedAmount,
          error: `1Click refunded ${amount} to your Receiving Address on ${sourceLabel}${reason}.`,
          updatedAt: now,
        })
        .where(guard);
      logSweep(
        "sweep_refunded",
        sweep,
        { refundedAmount: swap.refundedAmount, reason: swap.refundReason },
        "warn",
      );
      return readSweep(deps.db, sweep.id);
    }
    case "FAILED":
      return fail(
        deps.db,
        sweep,
        `1Click reports it couldn't deliver this Sweep. Follow its deposit on the NEAR Intents explorer.`,
      );
  }
}

async function awaitReceipt(
  deps: SweepDeps,
  { sweep, env }: SweepContext<EvmSweep>,
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
  if (receipt === "success") return confirm(deps.db, sweep);
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

/**
 * Reads whether a submitted Solana transaction landed. One that hasn't
 * fails only once the chain is past its last valid block height, and its
 * status is read again after the height so it can't have landed between
 * the two reads.
 */
async function awaitSolanaTransaction(
  deps: SweepDeps,
  { sweep, env }: SweepContext<SolanaSweep>,
): Promise<Sweep> {
  const network = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  const signature = sweep.sourceTxHash;
  if (!network || !signature) return sweep;
  let status: "success" | "failed" | null;
  try {
    status = await deps.readSolana.signatureStatus({ network, signature });
    if (status === null) {
      const height = await deps.readSolana.blockHeight({ network });
      if (height <= sweep.lastValidBlockHeight) return sweep;
      status = await deps.readSolana.signatureStatus({ network, signature });
    }
  } catch (error) {
    logSweep("sweep_solana_status_read_failed", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (status === "success") return confirm(deps.db, sweep);
  if (status === "failed") return fail(deps.db, sweep, `The transfer failed on ${network.label}.`);
  // Not landed, and past the last block height it could land at.
  return fail(
    deps.db,
    sweep,
    `The transfer didn't land on ${network.label} before its blockhash expired.`,
  );
}

/**
 * Reads whether a submitted NEAR Sweep's relayer transaction executed:
 * `confirmed` once its `ft_transfer` succeeded, `failed` if it (or the
 * delegate action) failed. One that hasn't executed fails only once the
 * chain is well past the delegate action's `nearMaxBlockHeight`, and its
 * status is read again after the height so it can't have executed between
 * the two reads.
 */
async function awaitNearTransfer(
  deps: SweepDeps,
  { sweep, env }: SweepContext<NearSweep>,
): Promise<Sweep> {
  const network = networkRegistry[env].find((n) => n.caip2 === sweep.sourceNetwork);
  const txHash = sweep.sourceTxHash;
  if (network?.kind !== "near" || !txHash) return sweep;
  let status: NearSweepStatus | null;
  try {
    status = await deps.readNear.sweepStatus({ network, txHash });
    if (status === null) {
      const height = await deps.readNear.finalBlockHeight({ network });
      if (height <= sweep.nearMaxBlockHeight + NEAR_UNLANDED_GRACE_BLOCKS) return sweep;
      status = await deps.readNear.sweepStatus({ network, txHash });
    }
  } catch (error) {
    logSweep("sweep_near_status_read_failed", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (status?.kind === "success") return confirm(deps.db, sweep);
  if (status?.kind === "failure") {
    logSweep("sweep_near_transfer_failed", sweep, { failure: status.error }, "warn");
    return fail(deps.db, sweep, `The transfer failed on ${network.label}.`);
  }
  // Not executed, and too far past the height it could land at.
  return fail(
    deps.db,
    sweep,
    `The transfer didn't land on ${network.label} before its delegate action expired.`,
  );
}

async function confirm(db: Db, sweep: Sweep): Promise<Sweep> {
  await db
    .update(sweeps)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "submitted")));
  logSweep("sweep_confirmed", sweep, { sourceTxHash: sweep.sourceTxHash });
  return readSweep(db, sweep.id);
}

/**
 * The MPC signer's answer in a Sweep's NEAR transaction: `pending` while
 * NEAR doesn't have it yet (or can't be read), the `SuccessValue` once the
 * transaction succeeded, or why the Sweep fails.
 *
 * The Provider's wallet sends its own transaction (`walletSentAnswer`). A
 * sponsored Sweep's transaction is the relayer's (`nearTxRelayer`), read
 * with the relayer as its sender (`relayedAnswer`).
 */
async function readMpcSignature(
  deps: SweepDeps,
  { provider, sweep, env }: SweepContext,
): Promise<"pending" | { ok: true; successValue: string } | { ok: false; error: string }> {
  if (!sweep.nearTxHash) return "pending";
  let outcome: NearTransactionOutcome | null;
  try {
    outcome = await deps.readNearTransaction({
      txHash: sweep.nearTxHash,
      senderId: sweep.nearTxRelayer ?? provider.accountId,
    });
  } catch (error) {
    logSweep("sweep_near_read_failed", sweep, { error: String(error) }, "warn");
    return "pending";
  }
  if (!outcome) return "pending";

  const answer =
    sweep.nearTxRelayer === null
      ? walletSentAnswer(outcome)
      : relayedAnswer(outcome, mpcSigners[env].contractId);
  if (answer === "pending" || !("failure" in answer)) return answer;
  logSweep("sweep_near_tx_failed", sweep, { failure: answer.failure }, "warn");
  return {
    ok: false,
    error: `NEAR transaction ${sweep.nearTxHash} failed, so the MPC signer didn't sign this Sweep.`,
  };
}

type MpcAnswer = "pending" | { ok: true; successValue: string } | { failure: unknown };

/** The MPC signer's answer in a transaction the Provider's wallet sent: its status. */
function walletSentAnswer(outcome: NearTransactionOutcome): MpcAnswer {
  const status = outcome.status as { SuccessValue?: unknown; Failure?: unknown } | null;
  if (status?.Failure !== undefined) return { failure: status.Failure };
  if (typeof status?.SuccessValue !== "string") return "pending";
  return { ok: true, successValue: status.SuccessValue };
}

/**
 * The MPC signer's answer in Herald's relayer transaction of a sponsored
 * Sweep: the `SuccessValue` of `mpc`'s receipt. The transaction's status is
 * the delegate receipt's empty `SuccessValue`, and any failed receipt
 * fails it: a delegate action that didn't land sent nothing to the MPC
 * signer.
 */
function relayedAnswer(outcome: NearTransactionOutcome, mpc: string): MpcAnswer {
  const status = outcome.status as { Failure?: unknown } | null;
  const failure =
    status?.Failure ??
    outcome.receipts_outcome
      ?.map((r) => (r.outcome?.status as { Failure?: unknown } | undefined)?.Failure)
      .find((f) => f !== undefined);
  if (failure !== undefined) return { failure };
  const answer = outcome.receipts_outcome
    ?.filter((r) => r.outcome?.executor_id === mpc)
    .map((r) => (r.outcome?.status as { SuccessValue?: unknown } | undefined)?.SuccessValue)
    .find((value): value is string => typeof value === "string" && value !== "");
  return answer === undefined ? "pending" : { ok: true, successValue: answer };
}

function notYourSignature(sweep: Sweep): string {
  return `The signature in NEAR transaction ${sweep.nearTxHash} isn't your Receiving Address's signature of this Sweep.`;
}

/** Checks the MPC signer's ECDSA signature and submits the signed transfer through the EVM chain queue. */
async function submitEvmSweep(
  deps: SweepDeps,
  context: SweepContext<EvmSweep>,
  successValue: string,
): Promise<Sweep> {
  const { provider, sweep } = context;
  const signature = parseMpcSignature(successValue);
  if (!signature) return fail(deps.db, sweep, "The MPC signer's answer isn't an ECDSA signature.");
  const signer = await recoverAddress({ hash: sweep.payloadHash as Hex, signature });
  if (signer.toLowerCase() !== provider.evmAddress.toLowerCase()) {
    return fail(deps.db, sweep, notYourSignature(sweep));
  }

  const data = encodeFunctionData({
    abi: transferWithAuthorizationAbi,
    functionName: "transferWithAuthorization",
    args: [
      provider.evmAddress as Hex,
      transferRecipient(sweep) as Hex,
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
  return markSubmitted(deps.db, context, submitted.hash);
}

/**
 * Checks the MPC signer's Ed25519 signature of the planned transaction's
 * message against the Solana Receiving Address, and hands the transaction,
 * signed by it, to the Solana chain queue, which adds the fee payer's
 * signature and sends it.
 */
async function submitSolanaSweep(
  deps: SweepDeps,
  context: SweepContext<SolanaSweep>,
  successValue: string,
): Promise<Sweep> {
  const { provider, sweep } = context;
  const signature = parseMpcEd25519Signature(successValue);
  if (!signature) {
    return fail(deps.db, sweep, "The MPC signer's answer isn't an Ed25519 signature.");
  }
  const message = solanaTransactionMessage(sweep.solanaTransaction);
  // Strict RFC 8032 verification: whatever passes it, Solana accepts.
  const valid = ed25519.verify(signature, message, base58.decode(provider.solanaAddress), {
    zip215: false,
  });
  const transaction = valid
    ? withSolanaSignature(sweep.solanaTransaction, provider.solanaAddress, signature)
    : null;
  if (!transaction) return fail(deps.db, sweep, notYourSignature(sweep));

  let submitted: SolanaSweepSubmissionResult;
  try {
    submitted = await deps.solanaQueue.submitSweep({ network: sweep.sourceNetwork, transaction });
  } catch (error) {
    // Safe to submit again: the queue answers the same signature for the
    // same transaction.
    logSweep("sweep_submission_unanswered", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (!submitted.ok) {
    return fail(deps.db, sweep, `Herald couldn't submit the transfer: ${submitted.message}`);
  }
  return markSubmitted(deps.db, context, submitted.signature);
}

/**
 * Checks the MPC signer's Ed25519 signature of the planned delegate
 * action's NEP-461 hash against the NEAR Receiving Address, and hands the
 * signed delegate action to the NEAR chain queue, whose relayer submits it.
 */
async function submitNearSweep(
  deps: SweepDeps,
  context: SweepContext<NearSweep>,
  successValue: string,
): Promise<Sweep> {
  const { provider, sweep } = context;
  const signature = parseMpcEd25519Signature(successValue);
  if (!signature) {
    return fail(deps.db, sweep, "The MPC signer's answer isn't an Ed25519 signature.");
  }
  const delegateAction = base64.decode(sweep.nearDelegateAction);
  const payload = nearDelegatePayloadHash(delegateAction);
  // Strict RFC 8032 verification, as NEAR verifies delegate actions.
  const valid =
    bytesToHex(payload) === sweep.payloadHash &&
    ed25519.verify(signature, payload, hexToBytes(provider.nearAddress), { zip215: false });
  if (!valid) return fail(deps.db, sweep, notYourSignature(sweep));

  let submitted: NearSweepSubmissionResult;
  try {
    submitted = await deps.nearQueue.submitSweep({
      network: sweep.sourceNetwork,
      signedDelegateAction: signedNearDelegate(delegateAction, signature),
    });
  } catch (error) {
    // Safe to submit again: the queue answers the same transaction for the
    // same signed delegate action.
    logSweep("sweep_submission_unanswered", sweep, { error: String(error) }, "warn");
    return sweep;
  }
  if (!submitted.ok) {
    return fail(deps.db, sweep, `Herald couldn't submit the transfer: ${submitted.message}`);
  }
  return markSubmitted(deps.db, context, submitted.transaction);
}

async function markSubmitted(db: Db, context: SweepContext, sourceTxHash: string): Promise<Sweep> {
  const { sweep } = context;
  const now = context.now ?? new Date();
  await db
    .update(sweeps)
    .set({ status: "submitted", sourceTxHash, submittedAt: now, updatedAt: now })
    .where(and(eq(sweeps.id, sweep.id), eq(sweeps.status, "awaiting_signature")));
  logSweep("sweep_submitted", sweep, { sourceTxHash });
  return readSweep(db, sweep.id);
}

const transferWithAuthorizationAbi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/** The MPC signer's answer (base64 JSON, as NEAR returns it), or undefined if it isn't JSON. */
function decodeMpcAnswer(successValue: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64.decode(successValue)));
  } catch {
    return undefined;
  }
}

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
  const parsed = MpcSignatureSchema.safeParse(decodeMpcAnswer(successValue));
  if (!parsed.success) return null;
  const { big_r, s, recovery_id } = parsed.data;
  return {
    r: `0x${big_r.affine_point.slice(2).toLowerCase()}`,
    s: `0x${s.scalar.toLowerCase()}`,
    yParity: recovery_id,
  };
}

// Shape read from mainnet `v1.signer` tx CLhgqus9hkSPMu93UdTw6oUj71Rg9KWbNiPQn1psNAo1:
// `{"scheme":"Ed25519","signature":[143,213,…]}`, the 64 signature bytes.
const MpcEd25519SignatureSchema = z.object({
  scheme: z.literal("Ed25519"),
  signature: z.array(z.number().int().min(0).max(255)).length(64),
});

/** The MPC signer's answer to an EdDSA `sign` as the 64 signature bytes, or null if it isn't one. */
function parseMpcEd25519Signature(successValue: string): Uint8Array | null {
  const parsed = MpcEd25519SignatureSchema.safeParse(decodeMpcAnswer(successValue));
  return parsed.success ? Uint8Array.from(parsed.data.signature) : null;
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
  { providerId, sweepId, env }: { providerId: number; sweepId: number; env: HeraldEnv },
): Promise<{ provider: Provider; sweep: Sweep } | null> {
  const [row] = await db
    .select({ sweep: sweeps, provider: providers })
    .from(sweeps)
    .innerJoin(providers, eq(providers.id, sweeps.providerId))
    .where(and(eq(sweeps.id, sweepId), eq(sweeps.providerId, providerId)));
  return row
    ? {
        provider: await providerFromRow(db, row.provider, env),
        sweep: SweepSchema.parse(row.sweep),
      }
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
    const { transaction, status, receipts_outcome } = body.result;
    // Not executed yet: the node answers its stage without an outcome.
    if (!transaction || status === undefined) return null;
    return { transaction, status, ...(receipts_outcome && { receipts_outcome }) };
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
 * Why USDC sent to `address` on `network` is lost, or null if it isn't: on
 * EVM, the zero address or the USDC contract; on Solana, the USDC mint or
 * the System Program; on NEAR, the USDC contract. (Planning a Solana Sweep also refuses token accounts
 * and Herald's fee payer, which it reads from the chain.)
 */
function lostDestination(address: string, network: Network): string | null {
  const lost = `USDC sent to ${address} on ${network.label} is lost. Sweep to an address you control.`;
  switch (network.kind) {
    case "evm": {
      const to = address.toLowerCase();
      return to === ZERO_ADDRESS || to === network.usdc.address.toLowerCase() ? lost : null;
    }
    case "solana":
      return address === network.usdc.address || address === SYSTEM_PROGRAM_ADDRESS ? lost : null;
    case "near":
      return address === network.usdc.address ? lost : null;
    default:
      return unhandledKind(network);
  }
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
  network: EvmNetwork,
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

/**
 * The MPC `sign` call for a planned Sweep, on the source Receiving
 * Address's derivation path and domain: the EIP-712 hash for an EVM Sweep
 * (ECDSA), the transaction message for a Solana one and the delegate
 * action's NEP-461 hash for a NEAR one (EdDSA).
 */
export function signRequestFor(env: HeraldEnv, sweep: Sweep): MpcSignRequest {
  const { path, domainId } = receivingAddressPaths[sweep.sourceKind];
  return {
    contractId: mpcSigners[env].contractId,
    methodName: "sign",
    args: { request: { payload_v2: signPayloadOf(sweep), path, domain_id: domainId } },
    gas: MPC_SIGN_GAS,
    deposit: MPC_SIGN_DEPOSIT,
  };
}

/** The MPC `payload_v2` of a planned Sweep. */
function signPayloadOf(sweep: Sweep): { Ecdsa: string } | { Eddsa: string } {
  switch (sweep.sourceKind) {
    case "evm":
      return { Ecdsa: sweep.payloadHash.slice(2) };
    case "solana":
      return { Eddsa: bytesToHex(solanaTransactionMessage(sweep.solanaTransaction)).slice(2) };
    case "near":
      return { Eddsa: sweep.payloadHash.slice(2) };
    default:
      return unhandledKind(sweep);
  }
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

function reject(
  reason: SweepPlanRejection,
  message: string,
): { ok: false; reason: SweepPlanRejection; message: string } {
  return { ok: false, reason, message };
}
