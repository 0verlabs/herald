import type { HeraldEnv, Caip2 } from "@herald/core";
import { issueApiKey, registerProvider } from "@herald/core/server";
import { createDb } from "@herald/db";
import { accepts } from "@hrld/x402";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme as ExactEvmClient } from "@x402/evm/exact/client";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { ExactSvmScheme as ExactSvmServer } from "@x402/svm/exact/server";
import { env } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FACILITATOR_URL } from "./network.ts";

/** A registered Provider with a fresh API key in `keyEnv` (testnet by default). */
export async function registeredProvider(accountId: string, keyEnv: HeraldEnv = "testnet") {
  const db = createDb(env.DB);
  const provider = await registerProvider(db, { accountId, env: "testnet" });
  const { apiKey, secret } = await issueApiKey(db, { providerId: provider.id, env: keyEnv });
  return { provider, apiKey, secret };
}

/** The stock facilitator client a Provider points at Herald, with its API key. */
export function facilitatorClient(apiKey?: string) {
  return new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
    ...(apiKey && {
      createAuthHeaders: async () => {
        const auth = { Authorization: `Bearer ${apiKey}` };
        return { verify: auth, settle: auth };
      },
    }),
  });
}

/**
 * A Buyer's signed payment for one of a Provider Account's Payment Options,
 * built the stock way: the Provider's `x402ResourceServer` turns the
 * `accepts()` option into payment requirements (checking it against Herald's
 * `/supported`), and a stock buyer client with a throwaway key signs it.
 */
export async function buyerPayment(input: {
  providerAccount: string;
  network: Caip2;
  apiKey: string;
}): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements; buyer: string }> {
  const [option] = accepts({
    providerAccount: input.providerAccount,
    price: "$0.001",
    env: "testnet",
    networks: [input.network],
  });
  if (!option) throw new Error(`accepts() offered nothing on ${input.network}`);

  const server = new x402ResourceServer(facilitatorClient(input.apiKey))
    .register("eip155:*", new ExactEvmServer())
    .register("solana:*", new ExactSvmServer());
  await server.initialize();
  const requirements = await server.buildPaymentRequirements(option);
  const paymentRequired = await server.createPaymentRequiredResponse(requirements, {
    url: "https://weather.example/weather",
    description: "Current weather",
    mimeType: "application/json",
  });

  const account = privateKeyToAccount(generatePrivateKey());
  const buyer = new x402Client().register("eip155:*", new ExactEvmClient(account));
  const payload = await buyer.createPaymentPayload(paymentRequired);
  const [accepted] = requirements;
  if (!accepted) throw new Error("The resource server built no requirements");
  return { payload, requirements: accepted, buyer: account.address };
}
