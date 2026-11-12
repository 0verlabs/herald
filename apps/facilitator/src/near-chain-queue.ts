import { Caip2Schema, networkRegistry, type Caip2 } from "@herald/core";
import type {
  NearChainQueueRpc,
  NearReceiptStatus,
  NearSettlementResult,
  NearSettlementSubmission,
} from "@herald/core/server";
import { base58, base64 } from "@scure/base";
import { decodeSignedDelegateB64, parseFtTransferArgs, settlementCacheKey } from "@x402/near";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { heraldEnvOf, NearRpcError, nearRelayerKey, nearRpc } from "./chains.ts";
import { signedDelegateTransaction, type SignedNearTransaction } from "./near-transactions.ts";

// Each RPC call while the queue waits on it must fail fast rather than stall
// every transaction behind it.
const RPC_TIMEOUT_MS = 8_000;
// How often a sent transaction's status is read until it is final.
const FINAL_POLL_MS = 500;

// A signed delegate holding one ft_transfer is a few hundred bytes.
const SettlementSubmissionSchema = z.object({
  network: Caip2Schema,
  signedDelegateAction: z.string().min(1).max(4096),
});

// The stock mechanism's cap on the gas a Buyer's ft_transfer may use, which
// the relayer pays for.
const MAX_SPONSORED_GAS = 100_000_000_000_000n;

/** A row of `settlements`: one per signed delegate action ever submitted. */
type SettlementRow = {
  delegate_hash: string;
  tx_hash: string | null;
  submitted_at: number;
};

type Outcome = {
  status?: { Failure?: unknown; SuccessValue?: string };
  receipts_outcome?: { outcome?: { executor_id?: string; status?: Record<string, unknown> } }[];
};

/**
 * The chain queue for one NEAR network, addressed by its CAIP-2 id
 * (`NEAR_CHAIN_QUEUE.getByName("near:testnet")`). It holds Herald's NEAR
 * relayer key (`NEAR_RELAYER_KEY`) and sends every relayer transaction, one
 * nonce at a time: the stock signer reads the key's nonce and adds one per
 * transaction, which collides under concurrent payments.
 *
 * Settlements (`submitSettlement`) wrap a Buyer's signed delegate action in
 * a relayer transaction. It remembers every signed delegate action it was
 * given, in its storage, so whichever isolate presents one again, it is
 * refused rather than relayed twice. The wait for a transaction to be final
 * happens outside the nonce lock, so one slow transaction doesn't hold up
 * the others.
 */
export class NearChainQueue extends DurableObject<CloudflareBindings> implements NearChainQueueRpc {
  // Tail of the send queue. Each send starts after the previous one has been
  // broadcast or has failed.
  #tail: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS settlements (
        delegate_hash TEXT PRIMARY KEY,
        tx_hash TEXT,
        submitted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relayer_nonce (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        nonce INTEGER NOT NULL
      )`,
    );
  }

  /** The relayer's account id: the implicit account of `NEAR_RELAYER_KEY`. */
  async relayer(): Promise<string> {
    return nearRelayerKey(this.env).accountId;
  }

  /**
   * Relays a Buyer's signed delegate action and waits, up to
   * `SETTLE_RECEIPT_TIMEOUT_MS`, until the relayer transaction is final.
   * Refuses one that isn't a single USDC `ft_transfer` signed by its
   * sender, one from the relayer itself, one for a network this Herald
   * environment doesn't list, and one it was given before.
   */
  async submitSettlement(input: NearSettlementSubmission): Promise<NearSettlementResult> {
    const parsed = SettlementSubmissionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Not a NEAR settlement submission" };
    const { network, signedDelegateAction } = parsed.data;
    const listed = this.#nearNetwork(network);
    if (!listed) {
      return {
        ok: false,
        message: `${network} is not a Herald NEAR network on ${this.env.HERALD_ENV}`,
      };
    }
    const problem = delegateProblem(
      signedDelegateAction,
      listed.usdc.address,
      nearRelayerKey(this.env).accountId,
    );
    if (problem) return { ok: false, message: problem };
    const sender = decodeSignedDelegateB64(signedDelegateAction).delegate.senderId;

    // Claimed before anything is awaited, so of two calls with the same
    // delegate action only the first gets past here.
    const delegateHash = settlementCacheKey(signedDelegateAction);
    const [previous] = this.ctx.storage.sql
      .exec<SettlementRow>("SELECT * FROM settlements WHERE delegate_hash = ?", delegateHash)
      .toArray();
    if (previous) {
      return {
        ok: false,
        message: previous.tx_hash
          ? `Herald already submitted this signed delegate action, in transaction ${previous.tx_hash}`
          : "Herald is already submitting this signed delegate action",
        ...(previous.tx_hash && { transaction: previous.tx_hash }),
      };
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO settlements (delegate_hash, tx_hash, submitted_at) VALUES (?, NULL, ?)",
      delegateHash,
      Date.now(),
    );

    const sent = await this.#enqueue(() =>
      this.#broadcast(network, sender, base64.decode(signedDelegateAction), delegateHash),
    );
    if (!sent.ok) return sent;
    const final = await this.#awaitFinal(network, sent.transaction);
    if (!final) {
      console.error(
        JSON.stringify({
          event: "near_settlement_not_final",
          network,
          transaction: sent.transaction.hash,
        }),
      );
      return {
        ok: false,
        message: `Relayer transaction ${sent.transaction.hash} wasn't final within ${this.env.SETTLE_RECEIPT_TIMEOUT_MS} ms`,
        transaction: sent.transaction.hash,
      };
    }
    return {
      ok: true,
      transaction: sent.transaction.hash,
      innerReceipt: innerReceiptOf(final, listed.usdc.address),
    };
  }

  #enqueue<T>(send: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(send);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #nearNetwork(caip2: string) {
    const network = networkRegistry[heraldEnvOf(this.env)].find((n) => n.caip2 === caip2);
    return network?.kind === "near" ? network : undefined;
  }

  /**
   * Signs the relayer transaction with the next nonce and broadcasts it.
   * Runs inside the send queue. The node refusing it (an `INVALID_TRANSACTION`
   * answer) means it was never sent: the claim on the delegate action is
   * released. A nonce the node finds stale (another sender used the key) is
   * re-read from the chain and tried once more. Without an answer the
   * transaction may have been sent, so it counts as sent and the wait for
   * it to be final decides.
   */
  async #broadcast(
    network: Caip2,
    sender: string,
    signedDelegate: Uint8Array,
    delegateHash: string,
  ): Promise<{ ok: true; transaction: SignedNearTransaction } | { ok: false; message: string }> {
    const relayer = nearRelayerKey(this.env);
    for (let attempt = 1; ; attempt++) {
      let transaction: SignedNearTransaction;
      try {
        const [nonce, blockHash] = await Promise.all([
          this.#nextNonce(network),
          this.#finalBlockHash(network),
        ]);
        transaction = signedDelegateTransaction({
          relayer,
          receiverId: sender,
          nonce,
          blockHash,
          signedDelegate,
        });
        // Recorded before broadcasting, so a lost answer or an eviction
        // mid-broadcast can't lead to the delegate action being sent twice.
        this.ctx.storage.sql.exec(
          "UPDATE settlements SET tx_hash = ? WHERE delegate_hash = ?",
          transaction.hash,
          delegateHash,
        );
        this.#useNonce(nonce);
      } catch (error) {
        this.#release(delegateHash);
        return {
          ok: false,
          message: `Herald couldn't prepare the relayer transaction: ${String(error)}`,
        };
      }
      try {
        await this.#send(network, transaction);
        return { ok: true, transaction };
      } catch (error) {
        if (!(error instanceof NearRpcError) || error.rpcCause !== "INVALID_TRANSACTION") {
          console.warn(
            JSON.stringify({
              event: "near_broadcast_unanswered",
              network,
              transaction: transaction.hash,
              error: String(error),
            }),
          );
          return { ok: true, transaction };
        }
        this.ctx.storage.sql.exec(
          "UPDATE settlements SET tx_hash = NULL WHERE delegate_hash = ?",
          delegateHash,
        );
        if (isInvalidNonce(error.info) && attempt === 1) {
          this.ctx.storage.sql.exec("DELETE FROM relayer_nonce");
          continue;
        }
        this.#release(delegateHash);
        return {
          ok: false,
          message: `The NEAR node refused the relayer transaction: ${JSON.stringify(error.info)}`,
        };
      }
    }
  }

  #release(delegateHash: string): void {
    this.ctx.storage.sql.exec("DELETE FROM settlements WHERE delegate_hash = ?", delegateHash);
  }

  async #send(network: Caip2, transaction: SignedNearTransaction): Promise<void> {
    await nearRpc(
      this.env,
      network,
      "send_tx",
      { signed_tx_base64: base64.encode(transaction.bytes), wait_until: "NONE" },
      RPC_TIMEOUT_MS,
    );
  }

  /**
   * The relayer key's next nonce: one above the last Herald used, or above
   * the key's nonce on chain if that is higher (or nothing is stored yet,
   * or after a stale nonce cleared it).
   */
  async #nextNonce(network: Caip2): Promise<bigint> {
    const [stored] = this.ctx.storage.sql
      .exec<{ nonce: number }>("SELECT nonce FROM relayer_nonce WHERE id = 1")
      .toArray();
    if (stored) return BigInt(stored.nonce) + 1n;
    const relayer = nearRelayerKey(this.env);
    const key = (await nearRpc(
      this.env,
      network,
      "query",
      {
        request_type: "view_access_key",
        finality: "final",
        account_id: relayer.accountId,
        public_key: `ed25519:${base58.encode(relayer.publicKey)}`,
      },
      RPC_TIMEOUT_MS,
    )) as { nonce?: unknown; error?: unknown };
    if (typeof key.nonce !== "number") {
      throw new Error(`The relayer ${relayer.accountId} has no access key for NEAR_RELAYER_KEY`);
    }
    return BigInt(key.nonce) + 1n;
  }

  #useNonce(nonce: bigint): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO relayer_nonce (id, nonce) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET nonce = excluded.nonce",
      Number(nonce),
    );
  }

  async #finalBlockHash(network: Caip2): Promise<Uint8Array> {
    const block = (await nearRpc(
      this.env,
      network,
      "block",
      { finality: "final" },
      RPC_TIMEOUT_MS,
    )) as {
      header?: { hash?: unknown };
    };
    if (typeof block.header?.hash !== "string") throw new Error("NEAR RPC block answered no hash");
    return base58.decode(block.header.hash);
  }

  /**
   * Reads a sent transaction until it is final, its receipts included, for
   * up to `SETTLE_RECEIPT_TIMEOUT_MS`; null if it isn't by then. One the node
   * doesn't know is broadcast again, in case the first broadcast never
   * reached it: a transaction lands at most once.
   */
  async #awaitFinal(network: Caip2, transaction: SignedNearTransaction): Promise<Outcome | null> {
    const relayer = nearRelayerKey(this.env).accountId;
    const deadline = Date.now() + Number(this.env.SETTLE_RECEIPT_TIMEOUT_MS);
    for (;;) {
      try {
        return (await nearRpc(
          this.env,
          network,
          "tx",
          { tx_hash: transaction.hash, sender_account_id: relayer, wait_until: "FINAL" },
          Math.max(deadline - Date.now(), 1_000),
        )) as Outcome;
      } catch (error) {
        if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_TRANSACTION") {
          await this.#send(network, transaction).catch(() => undefined);
        } else if (!(error instanceof NearRpcError && error.rpcCause === "TIMEOUT_ERROR")) {
          console.warn(
            JSON.stringify({
              event: "near_status_read_failed",
              transaction: transaction.hash,
              error: String(error),
            }),
          );
        }
      }
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, FINAL_POLL_MS));
    }
  }
}

/**
 * Why a signed delegate action isn't a payment Herald relays, or null if it
 * is: it must hold exactly one `ft_transfer` on `usdc` with the 1 yoctoNEAR
 * deposit NEP-141 asks for, at most the stock mechanism's sponsored gas,
 * signed by its sender's key, and not come from the relayer.
 */
function delegateProblem(
  signedDelegateAction: string,
  usdc: string,
  relayer: string,
): string | null {
  let decoded: ReturnType<typeof decodeSignedDelegateB64>;
  try {
    decoded = decodeSignedDelegateB64(signedDelegateAction);
  } catch {
    return "Not a NEAR signed delegate action";
  }
  const { delegate } = decoded;
  const call = delegate.functionCall;
  if (delegate.actionCount !== 1 || call?.methodName !== "ft_transfer") {
    return "Herald relays only a single ft_transfer";
  }
  if (delegate.receiverId !== usdc) return `Herald relays only transfers of USDC (${usdc})`;
  if (call.deposit !== 1n) return "The ft_transfer must attach exactly 1 yoctoNEAR";
  if (call.gas > MAX_SPONSORED_GAS) return "The ft_transfer asks for more gas than Herald sponsors";
  try {
    parseFtTransferArgs(call.args);
  } catch {
    return "The ft_transfer arguments aren't a receiver and an amount";
  }
  if (delegate.senderId === relayer) return "Herald's relayer can't be the payer";
  if (!decoded.verifySignature()) return "The delegate action's signature doesn't verify";
  return null;
}

/**
 * How a final relayer transaction's inner `ft_transfer` ended, the way the
 * stock `@x402/near` signer reads it: a failed transaction or receipt fails
 * it; otherwise it succeeded if the USDC contract's receipt has a
 * `SuccessValue`.
 */
function innerReceiptOf(outcome: Outcome, usdc: string): NearReceiptStatus {
  const describe = (failure: unknown) => JSON.stringify(failure);
  if (outcome.status?.Failure !== undefined) {
    return { kind: "failure", error: describe(outcome.status.Failure) };
  }
  const receipts = outcome.receipts_outcome ?? [];
  const failed = receipts.find((r) => r.outcome?.status?.["Failure"] !== undefined);
  if (failed) return { kind: "failure", error: describe(failed.outcome?.status?.["Failure"]) };
  const transfer = receipts.find((r) => r.outcome?.executor_id === usdc);
  const value = transfer?.outcome?.status?.["SuccessValue"];
  return typeof value === "string"
    ? { kind: "success", value }
    : { kind: "failure", error: "inner_ft_transfer_receipt_not_successful" };
}

function isInvalidNonce(info: unknown): boolean {
  return JSON.stringify(info ?? null).includes("InvalidNonce");
}
