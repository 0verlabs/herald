import type { Caip2 } from "@herald/core";
import type { NearSettlementResult } from "@herald/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
} from "@x402/core/types";
import { decodeSignedDelegateB64, parseFtTransferArgs } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import { facilitatorNearSigner } from "./near-signer.ts";

// The stock reason the resource server retries a settlement on, once.
const SETTLEMENT_PENDING = "settlement_pending";

/**
 * The stock `@x402/near` exact mechanism, with the `settlement_pending`
 * path the stock EVM and Solana mechanisms have. A relayer transaction that
 * isn't final within `SETTLE_RECEIPT_TIMEOUT_MS` may still land, so instead
 * of `settlement_failed` it is answered `settlement_pending` with its hash.
 * The Provider's resource server then retries once with the same payload;
 * the retry follows that transaction in `NearChainQueue` rather than
 * verifying again (the transfer has used the delegate's nonce by then) or
 * sending anything new. The pending payment is recorded once the retry sees
 * it final.
 */
export function nearExactScheme(env: CloudflareBindings, network: Caip2): SchemeNetworkFacilitator {
  // Settlements this request's stock mechanism saw answered `pending`, by
  // signed delegate action.
  const pending = new Map<string, string>();
  const stock = new ExactNearScheme(
    facilitatorNearSigner(env, network, (signedDelegateAction, transaction) =>
      pending.set(signedDelegateAction, transaction),
    ),
  );
  const queue = env.NEAR_CHAIN_QUEUE.getByName(network);

  return {
    scheme: stock.scheme,
    caipFamily: stock.caipFamily,
    getExtra: (n) => stock.getExtra(n),
    getSigners: (n) => stock.getSigners(n),
    verify: (payload, requirements) => stock.verify(payload, requirements),

    settle: async (payload, requirements) => {
      const signedDelegateAction = pendingCandidate(payload, requirements);
      if (signedDelegateAction) {
        const followed = await queue.awaitPendingSettlement({ network, signedDelegateAction });
        if (followed) return settleResponse(followed, requirements, signedDelegateAction);
      }
      const settled = await stock.settle(payload, requirements);
      const sda = signedDelegateOf(payload);
      const transaction = sda === undefined ? undefined : pending.get(sda);
      if (settled.success || transaction === undefined) return settled;
      return { ...settled, errorReason: SETTLEMENT_PENDING, transaction };
    },
  };
}

function signedDelegateOf(payload: PaymentPayload): string | undefined {
  const value = payload.payload["signedDelegateAction"];
  return typeof value === "string" ? value : undefined;
}

/**
 * The payload's signed delegate action if it is the payment these
 * requirements ask for: a USDC `ft_transfer` of exactly `amount` to `payTo`.
 * A retry follows a pending settlement only for the requirements it was
 * verified against, so it can't be recorded as another Provider's payment.
 */
function pendingCandidate(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): string | undefined {
  const signedDelegateAction = signedDelegateOf(payload);
  if (!signedDelegateAction) return undefined;
  try {
    const { delegate } = decodeSignedDelegateB64(signedDelegateAction);
    const call = delegate.functionCall;
    if (!call || delegate.receiverId !== requirements.asset) return undefined;
    const transfer = parseFtTransferArgs(call.args);
    if (transfer.receiver_id !== requirements.payTo) return undefined;
    if (transfer.amount !== requirements.amount) return undefined;
    return signedDelegateAction;
  } catch {
    return undefined;
  }
}

/** A followed settlement as the stock mechanism answers one. */
function settleResponse(
  result: NearSettlementResult,
  requirements: PaymentRequirements,
  signedDelegateAction: string,
): SettleResponse {
  const base = {
    network: requirements.network,
    payer: decodeSignedDelegateB64(signedDelegateAction).delegate.senderId,
  };
  if (result.ok) {
    return result.innerReceipt.kind === "success"
      ? { ...base, success: true, transaction: result.transaction }
      : {
          ...base,
          success: false,
          errorReason: "settlement_failed",
          errorMessage: result.innerReceipt.error,
          transaction: result.transaction,
        };
  }
  return {
    ...base,
    success: false,
    errorReason: result.pending ? SETTLEMENT_PENDING : "settlement_failed",
    errorMessage: result.message,
    transaction: result.transaction ?? "",
  };
}
