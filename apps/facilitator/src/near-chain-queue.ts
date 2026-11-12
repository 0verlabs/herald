import { Caip2Schema, NearImplicitAccountSchema, networkRegistry, type Caip2 } from "@herald/core";
import {
  setNearSetupStatus,
  type NearChainQueueRpc,
  type NearReceiptStatus,
  type NearSettlementResult,
  type NearSettlementSubmission,
  type NearSetupJob,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { base58, base64 } from "@scure/base";
import { decodeSignedDelegateB64, parseFtTransferArgs, settlementCacheKey } from "@x402/near";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { heraldEnvOf, NearRpcError, nearRelayerKey, nearRpc } from "./chains.ts";
import {
  delegateAction,
  functionCallAction,
  signedRelayerTransaction,
  transferAction,
  type NearAction,
  type SignedNearTransaction,
} from "./near-transactions.ts";

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

// Setting up a Provider's NEAR Receiving Address. A transfer creates the
// implicit account; 0.002 NEAR covers its own storage (182 bytes at
// 10^19 yoctoNEAR each, 0.00182 NEAR). Registering it on USDC costs
// USDC's `storage_balance_bounds`, 0.00125 NEAR on testnet and mainnet.
const ACCOUNT_CREATION_YOCTO = 2_000_000_000_000_000_000_000n;
const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
const STORAGE_DEPOSIT_GAS = 30_000_000_000_000n;

// Setup is tried this many times, waiting RETRY_DELAYS_MS[attempt - 1]
// after each failed attempt, before giving up until it is queued again.
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const SetupJobSchema = z.object({
  network: Caip2Schema,
  providerId: z.number().int().positive(),
  account: NearImplicitAccountSchema,
});

/** A row of `setup_jobs`: one per Provider, keyed by its NEAR Receiving Address. */
type SetupJobRow = {
  account: string;
  network: Caip2;
  provider_id: number;
  status: "queued" | "created" | "failed";
  attempts: number;
  next_attempt_at: number;
};

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
 *
 * It sets up Providers' NEAR Receiving Addresses, which NEAR payments need
 * to verify: the web Worker queues one when a Provider signs in
 * (`queueSetup`), and an alarm creates the implicit account and registers
 * it on USDC, each at most once, recording the outcome on the Provider in
 * D1.
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
      );
      CREATE TABLE IF NOT EXISTS setup_jobs (
        account TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        provider_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL
      )`,
    );
  }

  /** The relayer's account id: the implicit account of `NEAR_RELAYER_KEY`. */
  async relayer(): Promise<string> {
    return nearRelayerKey(this.env).accountId;
  }

  /**
   * Queues setting up a Provider's NEAR Receiving Address. This Durable
   * Object's own record is the source of truth: queueing one that is
   * already queued does nothing, one that was set up is recorded on the
   * Provider as `created` again (repairing a lost D1 write), and one the
   * queue gave up on starts over. Refuses a malformed job or one for a
   * network this Herald environment doesn't list.
   */
  async queueSetup(input: NearSetupJob): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = SetupJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Not a NEAR setup job" };
    const job = parsed.data;
    if (!this.#nearNetwork(job.network)) {
      return {
        ok: false,
        message: `${job.network} is not a Herald NEAR network on ${this.env.HERALD_ENV}`,
      };
    }
    const [existing] = this.ctx.storage.sql
      .exec<SetupJobRow>("SELECT * FROM setup_jobs WHERE account = ?", job.account)
      .toArray();
    if (existing?.status === "queued") return { ok: true };
    if (existing?.status === "created") {
      await setNearSetupStatus(createDb(this.env.DB), {
        providerId: existing.provider_id,
        status: "created",
      });
      return { ok: true };
    }
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO setup_jobs
         (account, network, provider_id, status, attempts, next_attempt_at)
       VALUES (?, ?, ?, 'queued', 0, ?)`,
      job.account,
      job.network,
      job.providerId,
      Date.now(),
    );
    await this.#scheduleNextAttempt();
    return { ok: true };
  }

  /**
   * Makes one attempt at every queued setup whose next attempt is due, then
   * sets the alarm for the next one due. Each setup transaction waits its
   * turn in the send queue; waiting for it to be final doesn't hold the
   * queue.
   */
  override async alarm(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<SetupJobRow>(
        "SELECT * FROM setup_jobs WHERE status = 'queued' AND next_attempt_at <= ?",
        Date.now(),
      )
      .toArray();
    for (const job of due) await this.#attemptSetup(job);
    await this.#scheduleNextAttempt();
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
      this.#broadcast(network, sender, [delegateAction(base64.decode(signedDelegateAction))], {
        // Recorded before broadcasting, so a lost answer or an eviction
        // mid-broadcast can't lead to the delegate action being sent twice.
        recordHash: (hash) =>
          this.ctx.storage.sql.exec(
            "UPDATE settlements SET tx_hash = ? WHERE delegate_hash = ?",
            hash,
            delegateHash,
          ),
      }),
    );
    if (!sent.ok) {
      this.#release(delegateHash);
      return sent;
    }
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
   * Signs a relayer transaction to `receiverId` holding `actions` with the
   * next nonce and broadcasts it. Runs inside the send queue. `recordHash`
   * gets the transaction's hash before it is broadcast, and null if the
   * node refused it. The node refusing it (an `INVALID_TRANSACTION` answer)
   * means it was never sent. A nonce the node finds stale (another sender
   * used the key) is re-read from the chain and tried once more. Without an
   * answer the transaction may have been sent, so it counts as sent and the
   * wait for it to be final decides.
   */
  async #broadcast(
    network: Caip2,
    receiverId: string,
    actions: NearAction[],
    { recordHash }: { recordHash?: (hash: string | null) => void } = {},
  ): Promise<{ ok: true; transaction: SignedNearTransaction } | { ok: false; message: string }> {
    const relayer = nearRelayerKey(this.env);
    for (let attempt = 1; ; attempt++) {
      let transaction: SignedNearTransaction;
      try {
        const [nonce, blockHash] = await Promise.all([
          this.#nextNonce(network),
          this.#finalBlockHash(network),
        ]);
        transaction = signedRelayerTransaction({ relayer, receiverId, nonce, blockHash, actions });
        recordHash?.(transaction.hash);
        this.#useNonce(nonce);
      } catch (error) {
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
        recordHash?.(null);
        if (isInvalidNonce(error.info) && attempt === 1) {
          this.ctx.storage.sql.exec("DELETE FROM relayer_nonce");
          continue;
        }
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

  async #scheduleNextAttempt(): Promise<void> {
    const [next] = this.ctx.storage.sql
      .exec<{ at: number | null }>(
        "SELECT MIN(next_attempt_at) AS at FROM setup_jobs WHERE status = 'queued'",
      )
      .toArray();
    if (next?.at != null) await this.ctx.storage.setAlarm(next.at);
  }

  /**
   * One attempt at setting up a NEAR Receiving Address. The outcome goes
   * into this Durable Object's record first, then onto the Provider in D1;
   * a failed D1 write is logged and repaired the next time the setup is
   * queued. Once the queue gives up, the Provider goes back to
   * `not_queued`, so its next sign-in queues the setup again.
   */
  async #attemptSetup(job: SetupJobRow): Promise<void> {
    const attempt = job.attempts + 1;
    let status: SetupJobRow["status"];
    let nextAttemptAt = Date.now();
    try {
      await this.#setUp(job);
      status = "created";
    } catch (error) {
      status = attempt >= MAX_ATTEMPTS ? "failed" : "queued";
      nextAttemptAt += RETRY_DELAYS_MS[attempt - 1] ?? 0;
      console.warn(
        JSON.stringify({
          event: "near_setup_attempt_failed",
          providerId: job.provider_id,
          account: job.account,
          attempt,
          gaveUp: status === "failed",
          error: String(error),
        }),
      );
    }
    this.ctx.storage.sql.exec(
      "UPDATE setup_jobs SET status = ?, attempts = ?, next_attempt_at = ? WHERE account = ?",
      status,
      attempt,
      nextAttemptAt,
      job.account,
    );
    if (status === "queued") return;
    try {
      await setNearSetupStatus(createDb(this.env.DB), {
        providerId: job.provider_id,
        status: status === "created" ? "created" : "not_queued",
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "near_setup_status_write_failed",
          providerId: job.provider_id,
          status,
          error: String(error),
        }),
      );
    }
  }

  /**
   * Creates `job.account`, the implicit account, with a transfer from the
   * relayer unless it exists, then registers it on USDC (`storage_deposit`)
   * unless it is registered. Each step reads the chain first, so a setup
   * tried again doesn't repeat a step that landed. Throws unless both
   * landed.
   */
  async #setUp(job: SetupJobRow): Promise<void> {
    const network = this.#nearNetwork(job.network);
    if (!network) throw new Error(`${job.network} is not a Herald NEAR network`);
    if (!(await this.#accountExists(job.network, job.account))) {
      const transaction = await this.#sendAndAwait(job.network, job.account, [
        transferAction(ACCOUNT_CREATION_YOCTO),
      ]);
      console.log(
        JSON.stringify({
          event: "near_account_created",
          providerId: job.provider_id,
          account: job.account,
          transaction,
        }),
      );
    }
    if (!(await this.#registeredOn(job.network, network.usdc.address, job.account))) {
      const transaction = await this.#sendAndAwait(job.network, network.usdc.address, [
        functionCallAction({
          methodName: "storage_deposit",
          args: { account_id: job.account, registration_only: true },
          gas: STORAGE_DEPOSIT_GAS,
          deposit: STORAGE_DEPOSIT_YOCTO,
        }),
      ]);
      console.log(
        JSON.stringify({
          event: "near_storage_registered",
          providerId: job.provider_id,
          account: job.account,
          transaction,
        }),
      );
    }
  }

  /**
   * Sends a relayer transaction through the send queue and waits until it
   * is final. Returns its hash; throws if it was refused, isn't final in
   * time, or failed.
   */
  async #sendAndAwait(network: Caip2, receiverId: string, actions: NearAction[]): Promise<string> {
    const sent = await this.#enqueue(() => this.#broadcast(network, receiverId, actions));
    if (!sent.ok) throw new Error(sent.message);
    const final = await this.#awaitFinal(network, sent.transaction);
    if (!final)
      throw new Error(`Relayer transaction ${sent.transaction.hash} wasn't final in time`);
    const failure = failureOf(final);
    if (failure) throw new Error(`Relayer transaction ${sent.transaction.hash} failed: ${failure}`);
    return sent.transaction.hash;
  }

  async #accountExists(network: Caip2, accountId: string): Promise<boolean> {
    try {
      await nearRpc(
        this.env,
        network,
        "query",
        { request_type: "view_account", finality: "final", account_id: accountId },
        RPC_TIMEOUT_MS,
      );
      return true;
    } catch (error) {
      if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_ACCOUNT") return false;
      throw error;
    }
  }

  /** Whether `accountId` is registered on the NEP-145 contract `token`. */
  async #registeredOn(network: Caip2, token: string, accountId: string): Promise<boolean> {
    const answer = (await nearRpc(
      this.env,
      network,
      "query",
      {
        request_type: "call_function",
        finality: "final",
        account_id: token,
        method_name: "storage_balance_of",
        args_base64: base64.encode(
          new TextEncoder().encode(JSON.stringify({ account_id: accountId })),
        ),
      },
      RPC_TIMEOUT_MS,
    )) as { result?: unknown; error?: unknown };
    if (!Array.isArray(answer.result)) {
      throw new Error(`storage_balance_of failed: ${JSON.stringify(answer.error ?? null)}`);
    }
    const balance: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(answer.result as number[])),
    );
    return balance !== null;
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
  const failure = failureOf(outcome);
  if (failure) return { kind: "failure", error: failure };
  const receipts = outcome.receipts_outcome ?? [];
  const transfer = receipts.find((r) => r.outcome?.executor_id === usdc);
  const value = transfer?.outcome?.status?.["SuccessValue"];
  return typeof value === "string"
    ? { kind: "success", value }
    : { kind: "failure", error: "inner_ft_transfer_receipt_not_successful" };
}

/** The failure of a final transaction or of one of its receipts, as JSON; null if none failed. */
function failureOf(outcome: Outcome): string | null {
  if (outcome.status?.Failure !== undefined) return JSON.stringify(outcome.status.Failure);
  const failed = (outcome.receipts_outcome ?? []).find(
    (r) => r.outcome?.status?.["Failure"] !== undefined,
  );
  return failed ? JSON.stringify(failed.outcome?.status?.["Failure"]) : null;
}

function isInvalidNonce(info: unknown): boolean {
  return JSON.stringify(info ?? null).includes("InvalidNonce");
}
