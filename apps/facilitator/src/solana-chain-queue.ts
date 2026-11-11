import {
  Caip2Schema,
  networkRegistry,
  SolanaAddressSchema,
  type Caip2,
  type SolanaTokenAccountStatus,
} from "@herald/core";
import {
  setSolanaTokenAccountStatus,
  type SolanaChainQueueRpc,
  type SolanaSweepSubmission,
  type SolanaSweepSubmissionResult,
  type SolanaTokenAccountJob,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isSolanaError,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Base64EncodedWireTransaction,
  type CompiledTransactionMessage,
  type Signature,
  type Transaction,
} from "@solana/kit";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  confirmSolanaTransaction,
  heraldEnvOf,
  solanaFeePayerAddress,
  solanaGasKey,
  solanaRpc,
} from "./chains.ts";
import { PendingSettlements } from "./pending-settlements.ts";
import { sweepTransactionProblem } from "./solana-sweeps.ts";

type Refusal = { ok: false; message: string };
export type SolanaSigningResult = { ok: true; transaction: string } | Refusal;
export type SolanaSubmissionResult = { ok: true; signature: string } | Refusal;
type QueueResult = { ok: true } | Refusal;

/**
 * How a send treats a transaction it has sent before (`refuse` it, or
 * `answer` its signature), and whether the node simulates it first.
 */
type SendOptions = { onResend: "refuse" | "answer"; preflight: boolean };

const SweepSubmissionSchema = z.object({
  network: Caip2Schema,
  // A Solana transaction is at most 1232 bytes, 1644 in base64.
  transaction: z.string().min(1).max(1644),
});

// Each submission makes RPC calls while the queue waits on it, so a hung
// endpoint must fail fast rather than stall every transaction behind it.
const RPC_TIMEOUT_MS = 8_000;

// Token-account creation is tried this many times, waiting
// RETRY_DELAYS_MS[attempt - 1] after each failed attempt, before giving up.
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const TokenAccountJobSchema = z.object({
  network: Caip2Schema,
  providerId: z.number().int().positive(),
  owner: SolanaAddressSchema,
});

/** A row of `token_account_jobs`: one per Provider, keyed by its Solana Receiving Address. */
type TokenAccountJobRow = {
  owner: string;
  network: Caip2;
  provider_id: number;
  status: Exclude<SolanaTokenAccountStatus, "not_queued">;
  attempts: number;
  next_attempt_at: number;
};

/**
 * The chain queue for one Solana network, addressed by its CAIP-2 id
 * (`SOLANA_CHAIN_QUEUE.getByName("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")`).
 * It holds Herald's Solana gas wallet, the fee payer, and sends every Solana
 * transaction Herald pays for, one at a time. It remembers the signature of
 * each transaction it has sent and refuses to send one again, so a payment
 * is never settled twice.
 *
 * Payments arrive signed by the Buyer with Herald's fee payer unsigned.
 * The gas wallet signs one only as the fee payer: never a transaction where
 * an instruction uses the gas wallet's account, so it can't be made to
 * transfer anything.
 *
 * It creates Providers' USDC token accounts, which Solana payments need to
 * land: the web Worker queues one when a Provider registers
 * (`queueTokenAccount`), and an alarm creates it, at most once per
 * Provider, recording the outcome on the Provider in D1.
 *
 * It sends Providers' Sweeps (`submitSweep`) from the web Worker, signing
 * as fee payer only transactions that are Sweeps.
 *
 * It also holds the stock mechanism's pending settlements (see
 * `PendingSettlements`).
 */
export class SolanaChainQueue
  extends DurableObject<CloudflareBindings>
  implements SolanaChainQueueRpc
{
  // Tail of the send queue. Each send starts after the previous one has been
  // broadcast or has failed.
  #tail: Promise<unknown> = Promise.resolve();
  #keyPair: Promise<CryptoKeyPair> | undefined;
  readonly #pending: PendingSettlements;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS submissions (
        signature TEXT PRIMARY KEY,
        submitted_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS token_account_jobs (
        owner TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        provider_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL
      )`,
    );
    this.#pending = new PendingSettlements(ctx.storage.sql);
  }

  /**
   * Queues creation of a Provider's USDC token account. This Durable
   * Object's own record is the source of truth: queueing one that is already
   * queued does nothing, one that was created is recorded on the Provider as
   * `created` again (repairing a lost D1 write), and one the queue gave up on
   * starts over. Refuses a malformed job or one for a network this Herald
   * environment doesn't list.
   */
  async queueTokenAccount(input: SolanaTokenAccountJob): Promise<QueueResult> {
    const parsed = TokenAccountJobSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Not a token account job" };
    const job = parsed.data;
    if (!this.#solanaNetwork(job.network)) {
      return {
        ok: false,
        message: `${job.network} is not a Herald Solana network on ${this.env.HERALD_ENV}`,
      };
    }
    const [existing] = this.ctx.storage.sql
      .exec<TokenAccountJobRow>("SELECT * FROM token_account_jobs WHERE owner = ?", job.owner)
      .toArray();
    if (existing?.status === "queued") return { ok: true };
    if (existing?.status === "created") {
      await setSolanaTokenAccountStatus(createDb(this.env.DB), {
        providerId: existing.provider_id,
        status: "created",
      });
      return { ok: true };
    }
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO token_account_jobs
         (owner, network, provider_id, status, attempts, next_attempt_at)
       VALUES (?, ?, ?, 'queued', 0, ?)`,
      job.owner,
      job.network,
      job.providerId,
      Date.now(),
    );
    await this.#scheduleNextAttempt();
    return { ok: true };
  }

  /**
   * Makes one attempt at every queued token account whose next attempt is
   * due, then sets the alarm for the next one due. Each account's send waits
   * its turn in the queue; its confirmation wait doesn't hold the queue.
   */
  override async alarm(): Promise<void> {
    const due = this.ctx.storage.sql
      .exec<TokenAccountJobRow>(
        "SELECT * FROM token_account_jobs WHERE status = 'queued' AND next_attempt_at <= ?",
        Date.now(),
      )
      .toArray();
    for (const job of due) await this.#attemptTokenAccount(job);
    await this.#scheduleNextAttempt();
  }

  /**
   * Adds the fee payer's signature to a Buyer's payment transaction (base64
   * wire format). Refuses one whose fee payer isn't Herald's gas wallet, or
   * where an instruction uses the gas wallet's account.
   */
  async signPayment(transaction: string): Promise<SolanaSigningResult> {
    const feePayer = solanaFeePayerAddress(this.env);
    let decoded: Transaction;
    let compiled: CompiledTransactionMessage;
    try {
      decoded = decodeTransaction(transaction);
      compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
    } catch {
      return { ok: false, message: "Not a Solana transaction" };
    }
    if (compiled.staticAccounts[0] !== feePayer) {
      return { ok: false, message: `The fee payer must be Herald's gas wallet, ${feePayer}` };
    }
    if (usesAccount(compiled, feePayer)) {
      return {
        ok: false,
        message: "Herald's gas wallet only pays fees; no instruction may use its account",
      };
    }
    const signed = await partiallySignTransaction([await this.#gasKeyPair()], decoded);
    return { ok: true, transaction: getBase64EncodedWireTransaction(signed) };
  }

  /**
   * Broadcasts a fully signed transaction whose fee payer is Herald's gas
   * wallet, and answers its signature. Refuses one it has already sent.
   */
  sendTransaction(network: Caip2, transaction: string): Promise<SolanaSubmissionResult> {
    return this.#enqueue(network, transaction, { onResend: "refuse", preflight: false });
  }

  /** The gas wallet's address, the fee payer of every Solana Sweep. */
  async feePayer(): Promise<string> {
    return solanaFeePayerAddress(this.env);
  }

  /**
   * Adds the fee payer's signature to a Sweep's transaction (base64 wire
   * format), already signed by the MPC network for a Provider's Receiving
   * Address, and sends it. The web Worker calls it through its cross-Worker
   * binding. It refuses anything but a Sweep (see `sweepTransactionProblem`):
   * the gas wallet pays the fee, and the rent of the destination's USDC
   * token account if the transaction creates it, nothing else.
   *
   * Unlike a settlement, sending the same transaction again answers its
   * signature, after broadcasting it again in case the first broadcast
   * never reached the node, so a Sweep whose answer was lost can safely be
   * submitted again: it lands at most once. The node simulates a new one
   * first, so one that would fail (an expired blockhash, a balance that
   * moved) is refused without costing a fee.
   */
  async submitSweep(submission: SolanaSweepSubmission): Promise<SolanaSweepSubmissionResult> {
    const parsed = SweepSubmissionSchema.safeParse(submission);
    if (!parsed.success) return { ok: false, message: "Not a Solana Sweep submission" };
    const { network, transaction } = parsed.data;
    const listed = this.#solanaNetwork(network);
    if (!listed) {
      return {
        ok: false,
        message: `${network} is not a Herald Solana network on ${this.env.HERALD_ENV}`,
      };
    }
    let decoded: Transaction;
    let problem: string | null;
    try {
      decoded = decodeTransaction(transaction);
      problem = await sweepTransactionProblem(
        decoded,
        solanaFeePayerAddress(this.env),
        address(listed.usdc.address),
      );
    } catch {
      return { ok: false, message: "Not a Solana transaction" };
    }
    if (problem) return { ok: false, message: problem };
    const signed = await partiallySignTransaction([await this.#gasKeyPair()], decoded);
    return this.#enqueue(network, getBase64EncodedWireTransaction(signed), {
      onResend: "answer",
      preflight: true,
    });
  }

  #enqueue(
    network: Caip2,
    transaction: string,
    options: SendOptions,
  ): Promise<SolanaSubmissionResult> {
    const run = this.#tail.then(() => this.#send(network, transaction, options));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #solanaNetwork(caip2: string) {
    const network = networkRegistry[heraldEnvOf(this.env)].find((n) => n.caip2 === caip2);
    return network?.kind === "solana" ? network : undefined;
  }

  /** `PendingSettlementStore.get` for the stock mechanism. */
  getPendingSettlement(settlementKey: string): string | undefined {
    return this.#pending.get(settlementKey);
  }

  /** `PendingSettlementStore.set` for the stock mechanism. */
  setPendingSettlement(settlementKey: string, signature: string): void {
    this.#pending.set(settlementKey, signature);
  }

  /** `PendingSettlementStore.delete` for the stock mechanism. */
  deletePendingSettlement(settlementKey: string): void {
    this.#pending.delete(settlementKey);
  }

  async #send(
    network: Caip2,
    transaction: string,
    { onResend, preflight }: SendOptions,
  ): Promise<SolanaSubmissionResult> {
    let signature: Signature;
    try {
      const decoded = decodeTransaction(transaction);
      const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
      if (compiled.staticAccounts[0] !== solanaFeePayerAddress(this.env)) {
        return { ok: false, message: "The fee payer must be Herald's gas wallet" };
      }
      signature = getSignatureFromTransaction(decoded);
    } catch {
      return { ok: false, message: "Not a Solana transaction signed by Herald's fee payer" };
    }
    const [previous] = this.ctx.storage.sql
      .exec("SELECT signature FROM submissions WHERE signature = ?", signature)
      .toArray();
    if (previous && onResend === "answer") {
      await this.#resend(network, transaction, signature);
      return { ok: true, signature };
    }
    if (previous) {
      return { ok: false, message: `Herald already sent transaction ${signature}` };
    }

    // Recorded before broadcasting, so neither a lost RPC response nor an
    // eviction mid-broadcast can lead to the transaction being sent twice.
    this.ctx.storage.sql.exec(
      "INSERT INTO submissions (signature, submitted_at) VALUES (?, ?)",
      signature,
      Date.now(),
    );
    try {
      await solanaRpc(this.env, network)
        .sendTransaction(transaction as Base64EncodedWireTransaction, {
          encoding: "base64",
          // The stock mechanism simulated payments while verifying; Sweeps
          // are simulated here.
          skipPreflight: !preflight,
          preflightCommitment: "confirmed",
        })
        .send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    } catch (error) {
      // A JSON-RPC error means the node answered and refused the
      // transaction. Without an answer (a timeout, a network or HTTP error)
      // the node may have it, so it counts as sent and its confirmation
      // decides; a signature lands at most once.
      if (isSolanaError(error) && error.context.__code < 0) {
        this.ctx.storage.sql.exec("DELETE FROM submissions WHERE signature = ?", signature);
        // A failed simulation's reason is its cause, the transaction error.
        const reason = error.cause instanceof Error ? `: ${error.cause.message}` : "";
        return { ok: false, message: `Broadcast refused: ${error.message}${reason}` };
      }
      console.warn(
        JSON.stringify({ event: "solana_broadcast_unanswered", signature, error: String(error) }),
      );
    }
    return { ok: true, signature };
  }

  /**
   * Broadcasts again a transaction sent before, whose first broadcast may
   * not have reached the node. A signature lands at most once, so this is
   * safe. Without preflight: simulating one that already landed would fail
   * as "already processed". Its outcome doesn't matter, so it's only logged.
   */
  async #resend(network: Caip2, transaction: string, signature: Signature): Promise<void> {
    try {
      await solanaRpc(this.env, network)
        .sendTransaction(transaction as Base64EncodedWireTransaction, {
          encoding: "base64",
          skipPreflight: true,
        })
        .send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    } catch (error) {
      console.warn(
        JSON.stringify({ event: "solana_rebroadcast_failed", signature, error: String(error) }),
      );
    }
  }

  async #scheduleNextAttempt(): Promise<void> {
    const [next] = this.ctx.storage.sql
      .exec<{ at: number | null }>(
        "SELECT MIN(next_attempt_at) AS at FROM token_account_jobs WHERE status = 'queued'",
      )
      .toArray();
    if (next?.at != null) await this.ctx.storage.setAlarm(next.at);
  }

  /**
   * One attempt at a token account. The outcome goes into this Durable
   * Object's record first, then onto the Provider in D1; a failed D1 write
   * is logged and repaired the next time the account is queued.
   */
  async #attemptTokenAccount(job: TokenAccountJobRow): Promise<void> {
    const attempt = job.attempts + 1;
    let status: TokenAccountJobRow["status"];
    let nextAttemptAt = Date.now();
    try {
      await this.#createTokenAccount(job);
      status = "created";
    } catch (error) {
      status = attempt >= MAX_ATTEMPTS ? "failed" : "queued";
      nextAttemptAt += RETRY_DELAYS_MS[attempt - 1] ?? 0;
      console.warn(
        JSON.stringify({
          event: "solana_token_account_attempt_failed",
          providerId: job.provider_id,
          owner: job.owner,
          attempt,
          gaveUp: status === "failed",
          error: String(error),
        }),
      );
    }
    this.ctx.storage.sql.exec(
      "UPDATE token_account_jobs SET status = ?, attempts = ?, next_attempt_at = ? WHERE owner = ?",
      status,
      attempt,
      nextAttemptAt,
      job.owner,
    );
    if (status === "queued") return;
    try {
      await setSolanaTokenAccountStatus(createDb(this.env.DB), {
        providerId: job.provider_id,
        status,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "solana_token_account_status_write_failed",
          providerId: job.provider_id,
          status,
          error: String(error),
        }),
      );
    }
  }

  /**
   * Creates `job.owner`'s USDC token account unless it exists, with the gas
   * wallet paying the fee and rent. Throws unless the account exists at the
   * end.
   */
  async #createTokenAccount(job: TokenAccountJobRow): Promise<void> {
    const network = this.#solanaNetwork(job.network);
    if (!network) throw new Error(`${job.network} is not a Herald Solana network`);
    const rpc = solanaRpc(this.env, job.network);
    const owner = address(job.owner);
    const mint = address(network.usdc.address);
    const [tokenAccount] = await findAssociatedTokenPda({
      owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const abortSignal = () => AbortSignal.timeout(RPC_TIMEOUT_MS);
    const { value: existing } = await rpc
      .getAccountInfo(tokenAccount, { encoding: "base64", commitment: "confirmed" })
      .send({ abortSignal: abortSignal() });
    if (existing) return;

    const payer = await createSignerFromKeyPair(await this.#gasKeyPair());
    const { value: blockhash } = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send({ abortSignal: abortSignal() });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          // Idempotent: it succeeds without change if the account appeared
          // since the check above.
          getCreateAssociatedTokenIdempotentInstruction({ payer, ata: tokenAccount, owner, mint }),
          m,
        ),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    const sent = await this.sendTransaction(
      job.network,
      getBase64EncodedWireTransaction(transaction),
    );
    if (!sent.ok) throw new Error(sent.message);
    await confirmSolanaTransaction(rpc, sent.signature, {
      timeoutMs: Number(this.env.SETTLE_RECEIPT_TIMEOUT_MS),
    });
    console.log(
      JSON.stringify({
        event: "solana_token_account_created",
        providerId: job.provider_id,
        owner: job.owner,
        tokenAccount,
        signature: sent.signature,
      }),
    );
  }

  #gasKeyPair(): Promise<CryptoKeyPair> {
    this.#keyPair ??= createKeyPairFromBytes(solanaGasKey(this.env));
    return this.#keyPair;
  }
}

function decodeTransaction(wire: string): Transaction {
  return getTransactionDecoder().decode(getBase64Encoder().encode(wire));
}

// Accounts loaded from address lookup tables can't sign, so only static
// accounts matter. Their resolved addresses stand in as a placeholder.
const LOOKUP_PLACEHOLDER = address("11111111111111111111111111111111");

/** Whether any instruction in the message uses `account`. */
function usesAccount(compiled: CompiledTransactionMessage, account: string): boolean {
  const lookups = "addressTableLookups" in compiled ? (compiled.addressTableLookups ?? []) : [];
  const instructions = getInstructionsFromCompiledTransactionMessage(compiled, {
    writable: lookups.flatMap((l) => l.writableIndexes.map(() => LOOKUP_PLACEHOLDER)),
    readonly: lookups.flatMap((l) => l.readonlyIndexes.map(() => LOOKUP_PLACEHOLDER)),
  });
  return instructions.some(
    (instruction) =>
      instruction.programAddress === account ||
      (instruction.accounts ?? []).some((meta) => meta.address === account),
  );
}
