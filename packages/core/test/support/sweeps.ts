import { createDb, providers } from "@herald/db";
import { base58, base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import type { Hex } from "viem";
import {
  ProviderSchema,
  type EvmAddress,
  type Provider,
  type SolanaAddress,
} from "../../src/index.ts";
import type {
  EvmReceiptReader,
  EvmSweepSubmission,
  EvmSweepSubmitter,
  MpcSignRequest,
  NearTransactionOutcome,
  NearTransactionReader,
  UsdcBalanceReader,
} from "../../src/server/index.ts";

const db = () => createDb(env.DB);

/**
 * A testnet Provider whose EVM Receiving Address belongs to a throwaway key
 * the test holds, standing in for the key the MPC network derives for the
 * Provider Account. Its row is written directly: `registerProvider` would
 * derive an address from the real MPC root key, which no test can sign for.
 */
export async function sweepingProvider(accountId: string) {
  const receivingKey = generatePrivateKey();
  const evmAddress = privateKeyToAccount(receivingKey).address.toLowerCase() as EvmAddress;
  await db()
    .insert(providers)
    .values({
      accountId,
      evmAddress,
      solanaAddress: "11111111111111111111111111111112" as SolanaAddress,
    });
  const [row] = await db().select().from(providers).where(eq(providers.accountId, accountId));
  const provider: Provider = ProviderSchema.parse(row);
  return { provider, receivingKey };
}

/** USDC balances keyed by owner address (any network); everyone else holds 0. */
export function usdcBalances(balances: Record<string, string>): UsdcBalanceReader {
  return async ({ owner }) => balances[owner.toLowerCase()] ?? balances[owner] ?? "0";
}

/** Like NEAR RPC's `tx` result, the parts Herald reads. */
type StoredTransaction = NearTransactionOutcome & { senderId: string };

/**
 * A fake NEAR network with the MPC signer contract on it. `sign` plays a
 * Provider's wallet sending `v1.signer-prod.testnet.sign`: it records the
 * transaction and its outcome the way NEAR RPC's `tx` method reports them,
 * with the MPC network's answer as the `SuccessValue`. The signing key
 * stands in for the key the MPC network derives for the signer.
 */
export class FakeNear {
  readonly #transactions = new Map<string, StoredTransaction>();

  /** Sends a `sign` call for `request` as `signerId` and returns its NEAR transaction hash. */
  async sign(input: {
    signerId: string;
    request: MpcSignRequest;
    /** The key the MPC network signs with, i.e. the one derived for `signerId`. */
    key: Hex;
    /** Ask the MPC network to sign this payload instead of the planned one. */
    payload?: Hex;
    /** Have the signing transaction fail on NEAR. */
    failure?: unknown;
    /** Leave the MPC network's answer out, as while it is still signing. */
    pending?: boolean;
  }): Promise<string> {
    const { request } = input;
    const payload = input.payload ?? (`0x${request.args.request.payload_v2.Ecdsa}` as Hex);
    const args = {
      request: { ...request.args.request, payload_v2: { Ecdsa: payload.slice(2) } },
    };
    const txHash = base58.encode(crypto.getRandomValues(new Uint8Array(32)));
    let status: NearTransactionOutcome["status"];
    if (input.failure) status = { Failure: input.failure };
    else if (input.pending) status = "Started";
    else status = { SuccessValue: await mpcAnswer(payload, input.key) };
    this.#transactions.set(txHash, {
      senderId: input.signerId,
      status,
      transaction: {
        hash: txHash,
        signer_id: input.signerId,
        receiver_id: request.contractId,
        actions: [
          {
            FunctionCall: {
              method_name: request.methodName,
              args: base64.encode(new TextEncoder().encode(JSON.stringify(args))),
              gas: Number(request.gas),
              deposit: request.deposit,
            },
          },
        ],
      },
    });
    return txHash;
  }

  /** The MPC network finishes signing a transaction `sign` left pending. */
  async finish(txHash: string, payload: Hex, key: Hex): Promise<void> {
    const stored = this.#transactions.get(txHash);
    if (stored) stored.status = { SuccessValue: await mpcAnswer(payload, key) };
  }

  /** A `NearTransactionReader` over this network; unknown transactions are null. */
  readonly readTransaction: NearTransactionReader = async ({ txHash, senderId }) => {
    const stored = this.#transactions.get(txHash);
    if (!stored || stored.senderId !== senderId) return null;
    const { senderId: _, ...outcome } = stored;
    return structuredClone(outcome);
  };
}

/**
 * The MPC network's answer to an ECDSA `sign`, base64 JSON as NEAR returns
 * it: `big_r` is R in compressed form, `s` low-s normalized, and
 * `recovery_id` R's y parity. (Shape read from a live
 * `v1.signer-prod.testnet` transaction.)
 */
async function mpcAnswer(payload: Hex, key: Hex): Promise<string> {
  const signature = await sign({ hash: payload, privateKey: key });
  const answer = {
    scheme: "Secp256k1",
    big_r: { affine_point: `${signature.yParity ? "03" : "02"}${signature.r.slice(2)}` },
    s: { scalar: signature.s.slice(2) },
    recovery_id: signature.yParity,
  };
  return base64.encode(new TextEncoder().encode(JSON.stringify(answer)));
}

/** Herald's chain queue, faked: it records every submission and answers with a hash. */
export class FakeChainQueue {
  readonly submissions: EvmSweepSubmission[] = [];
  /** Refuse submissions with this message, as the queue does when a broadcast fails. */
  refuseWith: string | null = null;
  /** Throw instead of answering, as when the queue can't be reached. */
  unreachable = false;

  readonly submit: EvmSweepSubmitter = async (submission) => {
    if (this.unreachable) throw new Error("The EVM chain queue didn't answer");
    if (this.refuseWith) return { ok: false, message: this.refuseWith };
    this.submissions.push(submission);
    return {
      ok: true,
      hash: `0x${"ab".repeat(31)}${this.submissions.length.toString(16).padStart(2, "0")}`,
    };
  };
}

/** Receipts by transaction hash; unknown hashes have none yet. */
export function fakeReceipts(receipts: Record<string, "success" | "reverted"> = {}) {
  const read: EvmReceiptReader = async ({ hash }) => receipts[hash] ?? null;
  return { receipts, read };
}
