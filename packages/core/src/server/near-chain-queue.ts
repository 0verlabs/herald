import type { Caip2 } from "../networks.ts";

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
 * `ft_transfer` ended, once final. `ok: false` when Herald didn't submit it
 * (a malformed or duplicate submission, a node that refused it) or couldn't
 * see it through to final; `transaction` is then the relayer transaction if
 * one was sent.
 */
export type NearSettlementResult =
  | { ok: true; transaction: string; innerReceipt: NearReceiptStatus }
  | { ok: false; message: string; transaction?: string };

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
   * Wraps a Buyer's signed delegate action in a relayer transaction, sends
   * it and waits until it is final. A signed delegate action is submitted at
   * most once, across isolates: presenting it again is refused, naming the
   * first submission's transaction.
   */
  submitSettlement(submission: NearSettlementSubmission): Promise<NearSettlementResult>;
}
