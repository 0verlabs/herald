import type { Caip2 } from "../networks.ts";
import type { NearImplicitAccount } from "../schemas.ts";

/**
 * What `NearChainQueueRpc` answers when it won't do what it was asked, and
 * why. It sends nothing for that request.
 */
export type NearQueueRefusal = { ok: false; message: string };

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
  | (NearQueueRefusal & { pending?: never; transaction?: string });

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
export type NearSweepSubmissionResult = { ok: true; transaction: string } | NearQueueRefusal;

/**
 * A sponsored Sweep's MPC `sign` call to relay (ADR 0010): a NEP-366
 * signed delegate action (base64 Borsh) from the Provider Account, signed
 * by its wallet, holding exactly one `sign` call to the Herald
 * environment's MPC signer. `network` is that environment's NEAR network,
 * where the MPC signer lives, whatever chain the Sweep is from.
 */
export type NearSponsoredSignSubmission = { network: Caip2; signedDelegateAction: string };

/**
 * A relayed sponsored `sign`: the relayer transaction's hash once it is
 * sent (not yet final), and the relayer that sent it, which reading the
 * transaction needs. `ok: false` when Herald didn't send it: a delegate
 * action that isn't a single `sign` to the MPC signer with 1 yoctoNEAR and
 * capped gas, one that expired or can't land, or a node that refused it.
 */
export type NearSponsoredSignResult =
  | { ok: true; transaction: string; relayer: string }
  | NearQueueRefusal;

/**
 * Herald's NEAR chain queue for Sweeps: the relayer's account id, and
 * submitting a signed Sweep for the relayer to send. Submitting the same
 * signed delegate action again answers the same transaction without
 * sending anything new. The relayer registers the transfer's receiver on
 * USDC first when it isn't (1Click's NEAR deposit addresses aren't), at
 * Herald's cost (0.00125 NEAR), so the Sweep's transfer can't fail for
 * that. Rejects if the queue can't be reached, or can't read or make that
 * registration, in which case submitting again is safe.
 *
 * `submitSponsoredSign` relays a sponsored Sweep's MPC `sign` call (see
 * `NearChainQueueRpc.submitSponsoredSign`), at most once per signed
 * delegate action: presenting it again answers the same transaction.
 * Rejects if the queue can't be reached or can't read what it checks, in
 * which case submitting the same signed delegate action again is safe.
 */
export type NearSweepQueue = {
  relayer(network: Caip2): Promise<string>;
  submitSweep(submission: NearSweepSubmission): Promise<NearSweepSubmissionResult>;
  submitSponsoredSign(submission: NearSponsoredSignSubmission): Promise<NearSponsoredSignResult>;
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
  queueSetup(job: NearSetupJob): Promise<{ ok: true } | NearQueueRefusal>;

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
   *
   * Before sending a new one, the relayer registers the transfer's receiver
   * on USDC when it isn't (1Click's NEAR deposit addresses aren't), at
   * Herald's cost (0.00125 NEAR), and waits until that is final, so the
   * Sweep's transfer can't fail for that. Rejects, having sent nothing of
   * the Sweep, if it can't read the block height or whether the receiver is
   * registered, or the registration doesn't land.
   */
  submitSweep(submission: NearSweepSubmission): Promise<NearSweepSubmissionResult>;

  /**
   * Relays a sponsored Sweep's MPC `sign` call (ADR 0010): wraps the
   * Provider Account's signed delegate action in a relayer transaction of
   * its own and sends it, paying the gas and the 1 yoctoNEAR deposit,
   * answering the transaction's hash without waiting for it to be final.
   * Presenting the same signed delegate action again answers the first
   * transaction (sent again, in case the first broadcast was lost) instead
   * of a new one.
   *
   * It checks the delegate action itself, whatever the caller checked: it
   * refuses one that isn't exactly one `sign` call to the Herald
   * environment's MPC signer with 1 yoctoNEAR and at most
   * `SPONSORED_SIGN_MAX_GAS`, validly signed by its sender, one from the
   * relayer itself, one at or near its `max_block_height`, and one the
   * chain would refuse: its key isn't one of the sender's full-access keys,
   * or its nonce is used. Rejects, having sent nothing, if it can't read
   * the block height or the sender's key.
   */
  submitSponsoredSign(submission: NearSponsoredSignSubmission): Promise<NearSponsoredSignResult>;
}
