import { networkRegistry } from "@herald/core";
import type { MessagePartialSigner, TransactionPartialSigner } from "@solana/kit";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { heraldEnvOf, rpcUrl, solanaFeePayerAddress } from "./chains.ts";
import { facilitatorEvmSigner, pendingSettlementStore } from "./evm-signer.ts";

/**
 * The stock x402 facilitator with the stock `exact` mechanism registered for
 * every network Herald lists in this Herald environment. EVM settlement goes
 * through the chain queues.
 *
 * Solana is registered so `/supported` lists it with Herald's fee payer, which
 * the stock resource server needs to start. Solana verify and settle are
 * refused before they reach the mechanism until the Solana chain queue
 * exists (#6), so its signer can't sign.
 */
export function createFacilitator(env: CloudflareBindings): x402Facilitator {
  const facilitator = new x402Facilitator();
  for (const network of networkRegistry[heraldEnvOf(env)]) {
    if (network.kind === "evm") {
      facilitator.register(
        network.caip2,
        new ExactEvmScheme(facilitatorEvmSigner(env, network.caip2), {
          pendingSettlementStore: pendingSettlementStore(env, network.caip2),
        }),
      );
    } else {
      const cannotSign = async (): Promise<never> => {
        throw new Error("Herald doesn't sign Solana transactions yet");
      };
      const feePayer: TransactionPartialSigner & MessagePartialSigner = {
        address: solanaFeePayerAddress(env),
        signTransactions: cannotSign,
        signMessages: cannotSign,
      };
      facilitator.register(
        network.caip2,
        new ExactSvmScheme(
          toFacilitatorSvmSigner(feePayer, { defaultRpcUrl: rpcUrl(env, network.caip2) }),
        ),
      );
    }
  }
  return facilitator;
}
