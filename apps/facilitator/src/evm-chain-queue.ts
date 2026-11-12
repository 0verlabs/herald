import type { Caip2 } from "@herald/core";
import type {
  EvmChainQueueRpc,
  EvmSweepSubmission,
  EvmSweepSubmissionResult,
} from "@herald/core/server";
import { eip3009ABI } from "@x402/evm";
import { DurableObject } from "cloudflare:workers";
import {
  BaseError,
  concat,
  createPublicClient,
  ExecutionRevertedError,
  createWalletClient,
  decodeFunctionData,
  keccak256,
  TransactionNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { evmChain, evmGasAccount, evmTransport } from "./chains.ts";
import { PendingSettlements } from "./pending-settlements.ts";

export type TransferWithAuthorizationSubmission = {
  network: Caip2;
  /** The EIP-3009 token contract (USDC). */
  asset: Address;
  /** ABI-encoded `transferWithAuthorization(...)` calldata. */
  data: Hex;
  dataSuffix?: Hex;
};

export type SubmissionResult = { ok: true; hash: Hex } | { ok: false; message: string };

// Each submission makes several RPC calls while the queue waits on it, so a
// hung endpoint must fail fast rather than stall every settlement behind it.
const RPC_TIMEOUT_MS = 8_000;

/**
 * The chain queue for one EVM network, addressed by its CAIP-2 id
 * (`EVM_CHAIN_QUEUE.getByName("eip155:84532")`). It owns that network's use
 * of the EVM gas wallet: every transaction is signed and broadcast here, one
 * at a time, so two Worker isolates never race on a nonce. It remembers each
 * EIP-3009 authorization it has submitted and refuses to submit one twice.
 *
 * It also holds the stock mechanism's pending settlements: a settlement
 * whose receipt didn't arrive in time is retried once by the Provider's
 * resource server, often on another isolate, and the retry must find the
 * transaction hash here instead of submitting again.
 *
 * It submits only `transferWithAuthorization` calls, so the gas wallet can't
 * be used for anything else: Buyer settlements, and Providers' Sweeps
 * (`submitSweep`) from the web Worker.
 */
export class EvmChainQueue extends DurableObject<CloudflareBindings> implements EvmChainQueueRpc {
  // Tail of the submission queue. Each submission starts after the previous
  // one has been broadcast or has failed.
  #tail: Promise<unknown> = Promise.resolve();
  readonly #pending: PendingSettlements;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS submissions (
        authorization_key TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        submitted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS submissions_nonce ON submissions (nonce)`,
    );
    this.#pending = new PendingSettlements(ctx.storage.sql);
  }

  /**
   * Signs and broadcasts a `transferWithAuthorization` from the gas wallet.
   * Refuses (`ok: false`) an authorization it has already submitted, or a
   * transaction the node rejected.
   */
  submitTransferWithAuthorization(
    submission: TransferWithAuthorizationSubmission,
  ): Promise<SubmissionResult> {
    return this.#enqueue(submission, "refuse");
  }

  /**
   * Signs and broadcasts a Sweep's `transferWithAuthorization`, signed by
   * the MPC network for a Provider's Receiving Address, from the gas wallet.
   * The web Worker calls it through its cross-Worker binding. Unlike a
   * settlement, submitting an authorization again answers the hash it was
   * first submitted in, without sending anything: a Sweep whose answer was
   * lost can safely be submitted again.
   */
  submitSweep(submission: EvmSweepSubmission): Promise<EvmSweepSubmissionResult> {
    return this.#enqueue(submission, "answer");
  }

  /**
   * The gas wallet's address: the public half of `EVM_GAS_KEY`, the same on
   * every EVM network. The web Worker's admin page shows it with its
   * balance.
   */
  async gasWallet(): Promise<string> {
    return evmGasAccount(this.env).address;
  }

  #enqueue(
    submission: TransferWithAuthorizationSubmission,
    onResubmit: "refuse" | "answer",
  ): Promise<SubmissionResult> {
    const run = this.#tail.then(() => this.#submit(submission, onResubmit));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  /** `PendingSettlementStore.get` for the stock mechanism. */
  getPendingSettlement(settlementKey: string): string | undefined {
    return this.#pending.get(settlementKey);
  }

  /** `PendingSettlementStore.set` for the stock mechanism. */
  setPendingSettlement(settlementKey: string, txHash: string): void {
    this.#pending.set(settlementKey, txHash);
  }

  /** `PendingSettlementStore.delete` for the stock mechanism. */
  deletePendingSettlement(settlementKey: string): void {
    this.#pending.delete(settlementKey);
  }

  async #submit(
    { network, asset, data, dataSuffix }: TransferWithAuthorizationSubmission,
    onResubmit: "refuse" | "answer",
  ): Promise<SubmissionResult> {
    const call = decodeFunctionData({ abi: eip3009ABI, data });
    if (call.functionName !== "transferWithAuthorization") {
      return {
        ok: false,
        message: `The chain queue only submits transferWithAuthorization, not ${call.functionName}`,
      };
    }
    const [from, , , , , authorizationNonce] = call.args;
    // EIP-3009 nonces are scoped to the authorizer and the token contract.
    const authorizationKey = `${asset.toLowerCase()}:${from.toLowerCase()}:${authorizationNonce.toLowerCase()}`;
    const [previous] = this.ctx.storage.sql
      .exec<{ tx_hash: string }>(
        "SELECT tx_hash FROM submissions WHERE authorization_key = ?",
        authorizationKey,
      )
      .toArray();
    if (previous && onResubmit === "answer") return { ok: true, hash: previous.tx_hash as Hex };
    if (previous) {
      // Worded so the stock mechanism reports `invalid_exact_evm_nonce_already_used`.
      return {
        ok: false,
        message: `EIP-3009 authorization is used: Herald already submitted it in ${previous.tx_hash}`,
      };
    }

    const chain = evmChain(network);
    const transport = evmTransport(this.env, network, {
      timeout: RPC_TIMEOUT_MS,
      retryCount: 1,
    });
    const client = createPublicClient({ chain, transport });
    const wallet = createWalletClient({ account: evmGasAccount(this.env), chain, transport });

    const nonce = await this.#nextNonce(client, wallet.account.address);
    let request;
    try {
      request = await wallet.prepareTransactionRequest({
        to: asset,
        data: dataSuffix ? concat([data, dataSuffix]) : data,
        nonce,
      });
    } catch (error) {
      // A Sweep whose transfer would revert (a bad signature, a balance
      // that moved) is refused for good, so its Sweep fails instead of
      // being retried. Settlements keep viem's error for the stock
      // mechanism to report.
      const reverted =
        error instanceof BaseError && error.walk((e) => e instanceof ExecutionRevertedError);
      if (onResubmit === "answer" && reverted) {
        return { ok: false, message: `The transfer would revert: ${error.shortMessage}` };
      }
      throw error;
    }
    const serializedTransaction = await wallet.signTransaction(request);
    const hash = keccak256(serializedTransaction);

    // Recorded before broadcasting, so neither a lost RPC response nor an
    // eviction mid-broadcast can lead to the authorization being sent twice.
    this.ctx.storage.sql.exec(
      "INSERT INTO submissions (authorization_key, tx_hash, nonce, submitted_at) VALUES (?, ?, ?, ?)",
      authorizationKey,
      hash,
      nonce,
      Date.now(),
    );
    try {
      await wallet.sendRawTransaction({ serializedTransaction });
    } catch (error) {
      // The node may have accepted it and lost the response, or a retry may
      // have answered "already known". Only a transaction the node doesn't
      // have counts as not sent.
      if (!(await isKnown(client, hash))) {
        this.ctx.storage.sql.exec(
          "DELETE FROM submissions WHERE authorization_key = ?",
          authorizationKey,
        );
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `Broadcast failed: ${message}` };
      }
    }
    return { ok: true, hash };
  }

  /**
   * The gas wallet's next nonce. The node's pending count is the starting
   * point. Herald's own transactions at or above it that the node knows
   * about are ones it hasn't counted yet (a load-balanced endpoint lagging),
   * so the nonce moves past them. The first one the node doesn't know was
   * dropped from the mempool, and its nonce is reused so later transactions
   * aren't stuck behind the gap.
   */
  async #nextNonce(client: PublicClient, address: Address): Promise<number> {
    let nonce = await client.getTransactionCount({ address, blockTag: "pending" });
    for (;;) {
      const [ours] = this.ctx.storage.sql
        .exec<{ tx_hash: Hex }>(
          "SELECT tx_hash FROM submissions WHERE nonce = ? ORDER BY submitted_at DESC LIMIT 1",
          nonce,
        )
        .toArray();
      if (!ours || !(await isKnown(client, ours.tx_hash))) return nonce;
      nonce += 1;
    }
  }
}

async function isKnown(client: PublicClient, hash: Hex): Promise<boolean> {
  try {
    await client.getTransaction({ hash });
    return true;
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return false;
    throw error;
  }
}
