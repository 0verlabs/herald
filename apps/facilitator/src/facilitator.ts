import { networkRegistry } from "@herald/core";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { ExactSvmScheme } from "@x402/svm/exact/facilitator";
import { heraldEnvOf } from "./chains.ts";
import { facilitatorEvmSigner, pendingSettlementStore } from "./evm-signer.ts";
import { facilitatorSvmSigner, solanaPendingSettlementStore } from "./svm-signer.ts";

/**
 * The stock x402 facilitator with the stock `exact` mechanism registered for
 * every network Herald lists in this Herald environment. Settlement goes
 * through each network's chain queue: `EvmChainQueue` on EVM networks,
 * `SolanaChainQueue` on Solana, where Herald's gas wallet is the fee payer.
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
      facilitator.register(
        network.caip2,
        new ExactSvmScheme(facilitatorSvmSigner(env, network.caip2), undefined, {
          pendingSettlementStore: solanaPendingSettlementStore(env, network.caip2),
        }),
      );
    }
  }
  return facilitator;
}
