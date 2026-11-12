import type { Caip2 } from "../networks.ts";
import type { NearImplicitAccount } from "../schemas.ts";

/**
 * A Buyer's NEAR payment to relay: a NEP-366 signed delegate action (base64
 * Borsh) holding one `ft_transfer` on the network's USDC contract, as the
 * stock `@x402/near` exact scheme carries it.
 */
export type NearSettlementSubmission = { network: Caip2; signedDelegateAction: string };

/**
 * How the delegate's inner `ft_transfer` receipt ended, in `@x402/near`'s
 * terms: its `SuccessValue`, or why it (or the delegate) failed.
 */
export type NearReceiptStatus =
  | { kind: "success"; value: string }
  | { kind: "failure"; error: string };

/**
 * A relayed settlement: the relayer transaction's hash and how the inner
 * `ft_transfer` ended, once final. `pending` when the relayer transaction
 * was sent but wasn't final in time: it may still land, and
 * `NearChainQueueRpc.awaitPendingSettlement` follows it from there.
 * Otherwise `ok: false` when Herald didn't submit it (a malformed or
 * duplicate submission, a node that refused it); `transaction` is then the
 * relayer transaction if one was sent.
 */
export type NearSettlementResult =
  | { ok: true; transaction: string; innerReceipt: NearReceiptStatus }
  | { ok: false; pending: true; message: string; transaction: string }
  | { ok: false; pending?: never; message: string; transaction?: string };

/**
 * A Provider's NEAR Sweep to relay: the signed delegate action (base64
 * Borsh) from the NEAR Receiving Address, holding one USDC `ft_transfer`.
 */
export type NearSweepSubmission = { network: Caip2; signedDelegateAction: string };

/**
 * A relayed Sweep: the relayer transaction's hash, once it is sent (not yet
 * final). `ok: false` when Herald didn't send it: a malformed or expired
 * delegate action, or a node that refused it.
 */
export type NearSweepSubmissionResult =
  | { ok: true; transaction: string }
  | { ok: false; message: string };

/**
 * Herald's NEAR chain queue for Sweeps: the relayer's account id, and
 * submitting a signed Sweep for the relayer to send. Submitting the same
 * signed delegate action again answers the same transaction without
 * sending anything new. Rejects if the queue can't be reached, in which
 * case submitting again is safe.
 */
export type NearSweepQueue = {
  relayer(network: Caip2): Promise<string>;
  submitSweep(submission: NearSweepSubmission): Promise<NearSweepSubmissionResult>;
};

/**
 * Setting up one Provider's NEAR Receiving Address on a NEAR network:
 * creating `account`, the implicit account, and registering it on USDC.
 */
export type NearSetupJob = { network: Caip2; providerId: number; account: NearImplicitAccount };

/**
 * The RPC interface the `NearChainQueue` Durable Object (in
 * `apps/facilitator`) offers, one object per NEAR network, named by its
 * CAIP-2 id (`NEAR_CHAIN_QUEUE.getByName("near:testnet")`). It holds the
 * relayer key (`NEAR_RELAYER_KEY`) and sends every relayer transaction, one
 * nonce at a time. Other Workers reach it through a cross-Worker Durable
 * Object binding.
 */
export interface NearChainQueueRpc {
  /** The relayer's account id: the implicit account of `NEAR_RELAYER_KEY`. */
  relayer(): Promise<string>;

  /**
   * Queues setting up a Provider's NEAR Receiving Address, at Herald's cost:
   * the relayer creates the implicit account and registers it on USDC, and
   * the outcome is recorded on the Provider (`setNearSetupStatus`).
   * Idempotent: a job it already has is ignored, and one it finished is
   * reported as `created` again. Refuses (`ok: false`) a job it can't take,
   * such as one for another network.
   */
  queueSetup(job: NearSetupJob): Promise<{ ok: true } | { ok: false; message: string }>;

  /**
   * Wraps a Buyer's signed delegate action in a relayer transaction, sends
   * it and waits until it is final. A signed delegate action is submitted at
   * most once, across isolates: presenting it again is refused, naming the
   * first submission's transaction. One sent but not final in time is
   * answered `pending` and remembered for a few minutes.
   */
  submitSettlement(submission: NearSettlementSubmission): Promise<NearSettlementResult>;

  /**
   * Follows a settlement that `submitSettlement` answered `pending`: waits
   * again until its relayer transaction is final, without sending anything
   * new. Null when this signed delegate action has no pending settlement.
   * Of concurrent calls for one settlement only one follows it; the others
   * get null. One still not final is answered `pending` again.
   */
  awaitPendingSettlement(
    submission: NearSettlementSubmission,
  ): Promise<NearSettlementResult | null>;

  /**
   * Wraps a Provider's signed Sweep in a relayer transaction and sends it,
   * answering its hash without waiting for it to be final. Presenting the
   * same signed delegate action again answers the first transaction (sent
   * again, in case the first broadcast was lost) instead of a new one.
   * Refuses a delegate action that isn't a single USDC `ft_transfer` signed
   * by its sender, or one that expired.
   */
  submitSweep(submission: NearSweepSubmission): Promise<NearSweepSubmissionResult>;
}
