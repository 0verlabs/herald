import {
  Caip2Schema,
  NearImplicitAccountSchema,
  networkRegistry,
  type Caip2,
  type Network,
} from "@herald/core";
import {
  delegateAction,
  finalBlock,
  ftTransferOutcome,
  functionCallAction,
  isStorageRegistered,
  NearRpcError,
  outcomeFailure,
  setNearSetupStatus,
  signedRelayerTransaction,
  transferAction,
  viewAccessKey,
  viewAccount,
  type NearAction,
  type NearChainQueueRpc,
  type NearOutcome,
  type NearQueueRefusal,
  type NearRpc,
  type NearSettlementResult,
  type NearSettlementSubmission,
  type NearSetupJob,
  type NearSweepSubmission,
  type NearSweepSubmissionResult,
  type SignedNearTransaction,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { base58, base64 } from "@scure/base";
import { decodeSignedDelegateB64, parseFtTransferArgs, settlementCacheKey } from "@x402/near";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { heraldEnvOf, nearRelayerKey, nearRpc } from "./chains.ts";
import { PendingSettlements } from "./pending-settlements.ts";

// Each RPC call while the queue waits on it must fail fast rather than stall
// every transaction behind it.
const RPC_TIMEOUT_MS = 8_000;
// How often a sent transaction's status is read until it is final.
const FINAL_POLL_MS = 500;

// A settlement or Sweep submission. A signed delegate holding one
// ft_transfer is a few hundred bytes.
const SubmissionSchema = z.object({
  network: Caip2Schema,
  signedDelegateAction: z.string().min(1).max(4096),
});

// A Sweep's delegate action this close to its `max_block_height` is refused
// rather than sent: the final height lags the chain's head by a few blocks,
// and the relayer would pay for a delegate action that fails as expired.
const SWEEP_EXPIRY_MARGIN_BLOCKS = 10;

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

/** A row of `sweeps`: one per signed Sweep the relayer sent, with the transaction carrying it. */
type SweepRow = {
  delegate_hash: string;
  tx_hash: string;
  tx_base64: string;
  submitted_at: number;
};

/** A row of `settlements`: one per signed delegate action ever submitted. */
type SettlementRow = {
  delegate_hash: string;
  tx_hash: string | null;
  submitted_at: number;
};

type Refusal = NearQueueRefusal;

type NearNetwork = Extract<Network, { kind: "near" }>;

/** A signed delegate action that passed `#relayable`, decoded. */
type Relayable = {
  network: NearNetwork;
  signedDelegateAction: string;
  delegate: ReturnType<typeof decodeSignedDelegateB64>["delegate"];
};

/** A relayer transaction that was sent: its hash, and its bytes when at hand for a rebroadcast. */
type SentTransaction = { hash: string; bytes?: Uint8Array };

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
 * the others. One not final in time is answered `pending` and followed
 * again when the Provider's resource server retries it
 * (`awaitPendingSettlement`), as the stock EVM and Solana mechanisms do.
 *
 * Sweeps (`submitSweep`) wrap a Provider's signed delegate action, from the
 * NEAR Receiving Address, the same way. Each is sent once: presenting it
 * again answers the transaction that carries it, sent again in case the
 * first broadcast never reached the node. The web Worker follows it from
 * there.
 *
 * It sets up Providers' NEAR Receiving Addresses, which NEAR payments need
 * to verify: the web Worker queues one when a Provider signs in, and the
 * facilitator's Cron Trigger (`scheduled.ts`) queues those not on their way
 * (`queueSetup`). An alarm creates the implicit account and registers
 * it on USDC, each at most once, recording the outcome on the Provider in
 * D1.
 */
export class NearChainQueue extends DurableObject<CloudflareBindings> implements NearChainQueueRpc {
  // Tail of the send queue. Each send starts after the previous one has been
  // broadcast or has failed.
  #tail: Promise<unknown> = Promise.resolve();
  // Settlements sent but not final in time, by delegate hash, until the
  // Provider's resource server retries them (`awaitPendingSettlement`).
  readonly #pending: PendingSettlements;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.#pending = new PendingSettlements(ctx.storage.sql);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS settlements (
        delegate_hash TEXT PRIMARY KEY,
        tx_hash TEXT,
        submitted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sweeps (
        delegate_hash TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        tx_base64 TEXT NOT NULL,
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
  async queueSetup(input: NearSetupJob): Promise<{ ok: true } | Refusal> {
    const parsed = SetupJobSchema.safeParse(input);
    if (!parsed.success) return refusal("Not a NEAR setup job");
    const job = parsed.data;
    if (!this.#nearNetwork(job.network)) return this.#unlisted(job.network);
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
    const relayable = this.#relayable(input, "Not a NEAR settlement submission");
    if (!relayable.ok) return relayable;
    const { network, signedDelegateAction, delegate } = relayable;

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
      this.#broadcast(
        network.caip2,
        delegate.senderId,
        [delegateAction(base64.decode(signedDelegateAction))],
        {
          // Recorded before broadcasting, so a lost answer or an eviction
          // mid-broadcast can't lead to the delegate action being sent twice.
          record: (transaction) =>
            this.ctx.storage.sql.exec(
              "UPDATE settlements SET tx_hash = ? WHERE delegate_hash = ?",
              transaction?.hash ?? null,
              delegateHash,
            ),
        },
      ),
    );
    if (!sent.ok) {
      this.#release(delegateHash);
      return sent;
    }
    return this.#settlementOutcome(network, delegateHash, sent.transaction);
  }

  /**
   * Follows a settlement `submitSettlement` answered `pending`, as the
   * Provider's resource server retries it: waits again, up to
   * `SETTLE_RECEIPT_TIMEOUT_MS`, until its relayer transaction is final.
   * Sends nothing new. Null when the signed delegate action has no pending
   * settlement. The pending record is taken before anything is awaited, so
   * of concurrent retries only one follows it.
   */
  async awaitPendingSettlement(
    input: NearSettlementSubmission,
  ): Promise<NearSettlementResult | null> {
    const parsed = SubmissionSchema.safeParse(input);
    if (!parsed.success) return null;
    const network = this.#nearNetwork(parsed.data.network);
    if (!network) return null;
    const delegateHash = settlementCacheKey(parsed.data.signedDelegateAction);
    const txHash = this.#pending.get(delegateHash);
    if (!txHash) return null;
    this.#pending.delete(delegateHash);
    return this.#settlementOutcome(network, delegateHash, { hash: txHash });
  }

  /**
   * Waits until a settlement's relayer transaction is final and reads how
   * its `ft_transfer` ended. One not final in time is recorded as pending,
   * for the resource server's retry, and answered `pending`.
   */
  async #settlementOutcome(
    network: NearNetwork,
    delegateHash: string,
    transaction: SentTransaction,
  ): Promise<NearSettlementResult> {
    const final = await this.#awaitFinal(network.caip2, transaction);
    if (!final) {
      this.#pending.set(delegateHash, transaction.hash);
      console.warn(
        JSON.stringify({
          event: "near_settlement_pending",
          network: network.caip2,
          transaction: transaction.hash,
        }),
      );
      return {
        ok: false,
        pending: true,
        message: `Relayer transaction ${transaction.hash} wasn't final within ${this.env.SETTLE_RECEIPT_TIMEOUT_MS} ms`,
        transaction: transaction.hash,
      };
    }
    return {
      ok: true,
      transaction: transaction.hash,
      innerReceipt: ftTransferOutcome(final, network.usdc.address),
    };
  }

  /**
   * Relays a Provider's signed Sweep: wraps it in a relayer transaction and
   * sends it, answering the transaction's hash without waiting for it to be
   * final. A Sweep it already sent is answered with the same transaction,
   * broadcast again. Refuses one that isn't a single USDC `ft_transfer`
   * signed by its sender, one from the relayer itself, one for a network
   * this Herald environment doesn't list, and one at or within a few
   * blocks of its `max_block_height`.
   */
  async submitSweep(input: NearSweepSubmission): Promise<NearSweepSubmissionResult> {
    const relayable = this.#relayable(input, "Not a NEAR Sweep submission");
    if (!relayable.ok) return relayable;
    const { signedDelegateAction } = relayable;
    const network = relayable.network.caip2;
    const { senderId, maxBlockHeight } = relayable.delegate;
    const delegateHash = settlementCacheKey(signedDelegateAction);
    const sent = this.#sentSweep(delegateHash);
    if (sent) return this.#answerSweep(network, sent);

    let height: bigint;
    try {
      height = BigInt((await finalBlock(this.#rpc(network))).height);
    } catch (error) {
      // Unanswered rather than refused: core leaves the Sweep for a retry.
      throw new Error(`Herald couldn't read the NEAR block height: ${String(error)}`);
    }
    if (height + BigInt(SWEEP_EXPIRY_MARGIN_BLOCKS) >= maxBlockHeight) {
      return refusal(
        `The signed delegate action expired at block ${maxBlockHeight} (NEAR is at ${height})`,
      );
    }

    return this.#enqueue(async () => {
      // Another call may have sent it while this one waited its turn.
      const already = this.#sentSweep(delegateHash);
      if (already) return { ok: true, transaction: already.tx_hash };
      const broadcast = await this.#broadcast(
        network,
        senderId,
        [delegateAction(base64.decode(signedDelegateAction))],
        {
          // Recorded before broadcasting, so the Sweep is never sent in two
          // relayer transactions.
          record: (transaction) => {
            if (!transaction) {
              this.ctx.storage.sql.exec("DELETE FROM sweeps WHERE delegate_hash = ?", delegateHash);
              return;
            }
            this.ctx.storage.sql.exec(
              "INSERT OR REPLACE INTO sweeps (delegate_hash, tx_hash, tx_base64, submitted_at) VALUES (?, ?, ?, ?)",
              delegateHash,
              transaction.hash,
              base64.encode(transaction.bytes),
              Date.now(),
            );
          },
        },
      );
      if (!broadcast.ok) return broadcast;
      console.log(
        JSON.stringify({
          event: "near_sweep_sent",
          network,
          sender: senderId,
          transaction: broadcast.transaction.hash,
        }),
      );
      return { ok: true, transaction: broadcast.transaction.hash };
    });
  }

  #sentSweep(delegateHash: string): SweepRow | undefined {
    return this.ctx.storage.sql
      .exec<SweepRow>("SELECT * FROM sweeps WHERE delegate_hash = ?", delegateHash)
      .toArray()[0];
  }

  /**
   * Answers a Sweep already sent with its relayer transaction, broadcast
   * again in case the first broadcast never reached the node. A node that
   * has it, or refuses it, changes nothing: it lands at most once.
   */
  async #answerSweep(network: Caip2, sent: SweepRow): Promise<NearSweepSubmissionResult> {
    await this.#send(network, {
      hash: sent.tx_hash,
      bytes: base64.decode(sent.tx_base64),
    }).catch(() => undefined);
    return { ok: true, transaction: sent.tx_hash };
  }

  #enqueue<T>(send: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(send);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #nearNetwork(caip2: string): NearNetwork | undefined {
    const network = networkRegistry[heraldEnvOf(this.env)].find((n) => n.caip2 === caip2);
    return network?.kind === "near" ? network : undefined;
  }

  #unlisted(network: string): Refusal {
    return refusal(`${network} is not a Herald NEAR network on ${this.env.HERALD_ENV}`);
  }

  /**
   * The signed delegate action in a settlement or Sweep submission, if
   * Herald relays it (`delegateProblem`) on a NEAR network this Herald
   * environment lists; otherwise why not, `malformed` for a submission that
   * isn't one at all.
   */
  #relayable(input: unknown, malformed: string): ({ ok: true } & Relayable) | Refusal {
    const parsed = SubmissionSchema.safeParse(input);
    if (!parsed.success) return refusal(malformed);
    const { signedDelegateAction } = parsed.data;
    const network = this.#nearNetwork(parsed.data.network);
    if (!network) return this.#unlisted(parsed.data.network);
    const problem = delegateProblem(
      signedDelegateAction,
      network.usdc.address,
      nearRelayerKey(this.env).accountId,
    );
    if (problem) return refusal(problem);
    const { delegate } = decodeSignedDelegateB64(signedDelegateAction);
    return { ok: true, network, signedDelegateAction, delegate };
  }

  /**
   * Signs a relayer transaction to `receiverId` holding `actions` with the
   * next nonce and broadcasts it. Runs inside the send queue. `record` gets
   * the signed transaction before it is broadcast, and null if the node
   * refused it. The node refusing it (an `INVALID_TRANSACTION` answer)
   * means it was never sent. A nonce the node finds stale (another sender
   * used the key) is re-read from the chain and tried once more. Without an
   * answer the transaction may have been sent, so it counts as sent and the
   * wait for it to be final decides.
   */
  async #broadcast(
    network: Caip2,
    receiverId: string,
    actions: NearAction[],
    { record }: { record?: (transaction: SignedNearTransaction | null) => void } = {},
  ): Promise<{ ok: true; transaction: SignedNearTransaction } | Refusal> {
    const relayer = nearRelayerKey(this.env);
    for (let attempt = 1; ; attempt++) {
      let transaction: SignedNearTransaction;
      try {
        const [nonce, block] = await Promise.all([
          this.#nextNonce(network),
          finalBlock(this.#rpc(network)),
        ]);
        const blockHash = base58.decode(block.hash);
        transaction = signedRelayerTransaction({ relayer, receiverId, nonce, blockHash, actions });
        record?.(transaction);
        this.#useNonce(nonce);
      } catch (error) {
        return refusal(`Herald couldn't prepare the relayer transaction: ${String(error)}`);
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
        record?.(null);
        if (isInvalidNonce(error.info) && attempt === 1) {
          this.ctx.storage.sql.exec("DELETE FROM relayer_nonce");
          continue;
        }
        return refusal(
          `The NEAR node refused the relayer transaction: ${JSON.stringify(error.info)}`,
        );
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
   * `not_queued`, so the facilitator's next scheduled run (or its next
   * sign-in) queues the setup again.
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
    const rpc = this.#rpc(job.network);
    if ((await viewAccount(rpc, job.account)) === null) {
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
    if (!(await isStorageRegistered(rpc, network.usdc.address, job.account))) {
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
    const failure = outcomeFailure(final);
    if (failure) throw new Error(`Relayer transaction ${sent.transaction.hash} failed: ${failure}`);
    return sent.transaction.hash;
  }

  /** The network's NEAR RPC endpoint, each call failing fast (`RPC_TIMEOUT_MS`). */
  #rpc(network: Caip2): NearRpc {
    return nearRpc(this.env, network, RPC_TIMEOUT_MS);
  }

  async #send(network: Caip2, transaction: SignedNearTransaction): Promise<void> {
    await this.#rpc(network).call("send_tx", {
      signed_tx_base64: base64.encode(transaction.bytes),
      wait_until: "NONE",
    });
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
    const key = await viewAccessKey(
      this.#rpc(network),
      relayer.accountId,
      `ed25519:${base58.encode(relayer.publicKey)}`,
    );
    if (key === null) {
      throw new Error(`The relayer ${relayer.accountId} has no access key for NEAR_RELAYER_KEY`);
    }
    return key.nonce + 1n;
  }

  #useNonce(nonce: bigint): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO relayer_nonce (id, nonce) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET nonce = excluded.nonce",
      Number(nonce),
    );
  }

  /**
   * Reads a sent transaction until it is final, its receipts included, for
   * up to `SETTLE_RECEIPT_TIMEOUT_MS`; null if it isn't by then. One the node
   * doesn't know is broadcast again when its bytes are at hand, in case the
   * first broadcast never reached it: a transaction lands at most once.
   */
  async #awaitFinal(network: Caip2, transaction: SentTransaction): Promise<NearOutcome | null> {
    const relayer = nearRelayerKey(this.env).accountId;
    const deadline = Date.now() + Number(this.env.SETTLE_RECEIPT_TIMEOUT_MS);
    for (;;) {
      try {
        return (await nearRpc(this.env, network, Math.max(deadline - Date.now(), 1_000)).call(
          "tx",
          {
            tx_hash: transaction.hash,
            sender_account_id: relayer,
            wait_until: "FINAL",
          },
        )) as NearOutcome;
      } catch (error) {
        if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_TRANSACTION") {
          const { hash, bytes } = transaction;
          if (bytes) await this.#send(network, { hash, bytes }).catch(() => undefined);
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

function refusal(message: string): Refusal {
  return { ok: false, message };
}

function isInvalidNonce(info: unknown): boolean {
  return JSON.stringify(info ?? null).includes("InvalidNonce");
}
