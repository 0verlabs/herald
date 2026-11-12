import type { HeraldEnv, Caip2 } from "@herald/core";
import { issueApiKey, registerProvider } from "@herald/core/server";
import { createDb } from "@herald/db";
import { accepts } from "@hrld/x402";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme as ExactEvmClient } from "@x402/evm/exact/client";
import { ExactEvmScheme as ExactEvmServer } from "@x402/evm/exact/server";
import { createClientNearSigner } from "@x402/near";
import { ExactNearScheme as ExactNearClient } from "@x402/near/exact/client";
import { ExactNearScheme as ExactNearServer } from "@x402/near/exact/server";
import { ExactSvmScheme as ExactSvmClient } from "@x402/svm/exact/client";
import { ExactSvmScheme as ExactSvmServer } from "@x402/svm/exact/server";
import { generateKeyPairSigner } from "@solana/kit";
import { base58 } from "@scure/base";
import { env } from "cloudflare:workers";
import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { FakeNearChain } from "./fake-near-chain.ts";
import { FACILITATOR_URL } from "./network.ts";

/** A registered Provider with a fresh API key in `keyEnv` (testnet by default). */
export async function registeredProvider(accountId: string, keyEnv: HeraldEnv = "testnet") {
  const db = createDb(env.DB);
  const provider = await registerProvider(db, { accountId, env: "testnet" });
  const { apiKey, secret } = await issueApiKey(db, { providerId: provider.id, env: keyEnv });
  return { provider, apiKey, secret };
}

/** The address of Herald's Solana fee payer, from the test's `SOLANA_GAS_KEY`. */
export function solanaFeePayer(): string {
  return base58.encode(base58.decode(env.SOLANA_GAS_KEY).subarray(32));
}

/**
 * The stock facilitator client a Provider points at Herald, with its API
 * key, at `url` (the in-process facilitator by default).
 */
export function facilitatorClient(apiKey?: string, url = FACILITATOR_URL) {
  return new HTTPFacilitatorClient({
    url,
    ...(apiKey && {
      createAuthHeaders: async () => {
        const auth = { Authorization: `Bearer ${apiKey}` };
        return { verify: auth, settle: auth };
      },
    }),
  });
}

/** USDC every NEAR Buyer starts with: 1 USDC. */
export const NEAR_BUYER_USDC = 1_000_000n;

/**
 * A NEAR Buyer on the fake NEAR testnet: an implicit account with a
 * full-access key and `NEAR_BUYER_USDC`, and no NEAR to speak of.
 */
export function nearBuyer(near: FakeNearChain): {
  accountId: string;
  secretKey: `ed25519:${string}`;
} {
  const keyPair = KeyPair.fromRandom("ed25519");
  const accountId = keyToImplicitAddress(keyPair.getPublicKey());
  near.addAccount(accountId, keyPair.getPublicKey().toString(), 0n);
  near.fundUsdc(accountId, NEAR_BUYER_USDC);
  return { accountId, secretKey: keyPair.toString() as `ed25519:${string}` };
}

/**
 * A Buyer's signed payment for one of a Provider Account's Payment Options,
 * built the stock way: the Provider's `x402ResourceServer` turns the
 * `accepts()` option into payment requirements (checking it against Herald's
 * `/supported`), and a stock buyer client with a throwaway key signs it: a
 * viem account on EVM, a Solana key pair on Solana, and on NEAR the stock
 * `createClientNearSigner` with a `nearBuyer` on `near`, reading the fake
 * NEAR RPC. `buyer` is its address (on NEAR, its account id).
 */
export async function buyerPayment(input: {
  providerAccount: string;
  network: Caip2;
  apiKey: string;
  /** The fake NEAR testnet, needed to pay on NEAR. */
  near?: FakeNearChain;
}): Promise<{
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  buyer: string;
  /** The Provider's stock resource server, for settling the way middleware does. */
  server: x402ResourceServer;
}> {
  const [option] = accepts({
    providerAccount: input.providerAccount,
    price: "$0.001",
    env: "testnet",
    networks: [input.network],
  });
  if (!option) throw new Error(`accepts() offered nothing on ${input.network}`);

  const server = new x402ResourceServer(facilitatorClient(input.apiKey))
    .register("eip155:*", new ExactEvmServer())
    .register("solana:*", new ExactSvmServer())
    .register("near:*", new ExactNearServer());
  await server.initialize();
  const requirements = await server.buildPaymentRequirements(option);
  const paymentRequired = await server.createPaymentRequiredResponse(requirements, {
    url: "https://weather.example/weather",
    description: "Current weather",
    mimeType: "application/json",
  });

  const evmAccount = privateKeyToAccount(generatePrivateKey());
  const solanaSigner = await generateKeyPairSigner();
  const client = new x402Client()
    .register("eip155:*", new ExactEvmClient(evmAccount))
    .register("solana:*", new ExactSvmClient(solanaSigner));
  let buyer: string = evmAccount.address;
  if (input.network.startsWith("solana:")) buyer = solanaSigner.address;
  if (input.network.startsWith("near:")) {
    if (!input.near) throw new Error("Paying on NEAR needs the fake NEAR testnet");
    const nearAccount = nearBuyer(input.near);
    buyer = nearAccount.accountId;
    client.register(
      "near:*",
      new ExactNearClient(
        createClientNearSigner({ ...nearAccount, rpcUrls: { [input.network]: env.NEAR_RPC_URL } }),
      ),
    );
  }
  const payload = await client.createPaymentPayload(paymentRequired);
  const [accepted] = requirements;
  if (!accepted) throw new Error("The resource server built no requirements");
  return { payload, requirements: accepted, buyer, server };
}
