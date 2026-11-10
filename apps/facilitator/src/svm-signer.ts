import type { Caip2 } from "@herald/core";
import type { MessagePartialSigner, TransactionPartialSigner } from "@solana/kit";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import {
  toFacilitatorSvmSigner,
  type FacilitatorRpcClient,
  type FacilitatorSvmSigner,
} from "@x402/svm";
import { confirmSolanaTransaction, solanaFeePayerAddress, solanaRpc } from "./chains.ts";

/**
 * The signer the stock `@x402/svm` exact mechanism settles with. Reads and
 * simulations go straight to the network's RPC endpoint. Signing as the fee
 * payer and sending go through the network's chain queue, which holds the
 * gas wallet.
 *
 * The confirmation wait is `SETTLE_RECEIPT_TIMEOUT_MS`, well inside the stock
 * HTTPFacilitatorClient's 90 s timeout. When it runs out, the mechanism
 * answers `settlement_pending` and the resource server retries once.
 */
export function facilitatorSvmSigner(
  env: CloudflareBindings,
  network: Caip2,
): FacilitatorSvmSigner {
  const queue = env.SOLANA_CHAIN_QUEUE.getByName(network);
  const feePayer = solanaFeePayerAddress(env);
  const signsInQueue = async (): Promise<never> => {
    throw new Error("Herald's fee payer signs in the Solana chain queue");
  };
  const keyless: TransactionPartialSigner & MessagePartialSigner = {
    address: feePayer,
    signTransactions: signsInQueue,
    signMessages: signsInQueue,
  };
  // Herald's client, not one the stock signer builds from the URL, so its
  // errors never name the endpoint (see `solanaRpc`). It goes in a
  // per-network map: the stock signer spots a single client with
  // `"getBalance" in config`, which kit's Proxy-based client fails. The
  // stock type adds a type-only cluster tag that kit sets only for URLs built
  // with `devnet()` / `mainnet()`; the client itself is the same.
  const rpc = solanaRpc(env, network);
  const reads = toFacilitatorSvmSigner(keyless, { [network]: rpc as FacilitatorRpcClient });
  const confirmationTimeout = Number(env.SETTLE_RECEIPT_TIMEOUT_MS);

  return {
    ...reads,
    signTransaction: async (transaction, payer) => {
      if (payer !== feePayer) throw new Error(`Herald has no fee payer ${payer}`);
      const signed = await queue.signPayment(transaction);
      if (!signed.ok) throw new Error(signed.message);
      return signed.transaction;
    },
    sendTransaction: async (transaction) => {
      const sent = await queue.sendTransaction(network, transaction);
      if (!sent.ok) throw new Error(sent.message);
      return sent.signature;
    },
    confirmTransaction: (signature, _network, options) =>
      confirmSolanaTransaction(rpc, signature, {
        timeoutMs: confirmationTimeout,
        ...(options?.searchTransactionHistory && { searchTransactionHistory: true }),
      }),
  };
}

/**
 * The stock mechanism's store of sent-but-unconfirmed settlements, kept in
 * the network's chain queue so a retry on any isolate finds it.
 */
export function solanaPendingSettlementStore(
  env: CloudflareBindings,
  network: Caip2,
): PendingSettlementStore {
  const queue = env.SOLANA_CHAIN_QUEUE.getByName(network);
  return {
    get: async (key) => (await queue.getPendingSettlement(key)) ?? undefined,
    set: async (key, signature) => {
      await queue.setPendingSettlement(key, signature);
    },
    delete: async (key) => {
      await queue.deletePendingSettlement(key);
    },
  };
}
