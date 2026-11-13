import { decodePaymentRequiredHeader } from "@x402/core/http";
import { PaymentRequiredSchema } from "@x402/core/schemas";
import {
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type RoutesConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactNearScheme } from "@x402/near/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { describe, expect, test } from "vite-plus/test";
import { accepts, type Caip2, type HeraldEnv } from "./index.ts";

// Feeds accepts() to the stock x402 v2 resource server, the way a Provider's
// middleware does, to catch stock x402 changes that would break it.

// A placeholder Solana fee payer, as a facilitator's /supported lists it.
const feePayer = "FeePayer1111111111111111111111111111111111";

// A placeholder NEAR relayer, as a facilitator's /supported lists it.
const relayer = "ab".repeat(32);

// Answers /supported for every network the Payment Options use, as Herald's
// facilitator does: Solana kinds carry the fee payer, and NEAR's relayer is
// listed under `signers`. Verify and settle are never reached by an unpaid
// request.
function facilitatorFor(networks: Caip2[]): FacilitatorClient {
  return {
    getSupported: async () => ({
      kinds: networks.map((network) => ({
        x402Version: 2,
        scheme: "exact",
        network,
        ...(network.startsWith("solana:") ? { extra: { feePayer } } : {}),
      })),
      extensions: [],
      signers: Object.fromEntries(
        networks.some((network) => network.startsWith("near:")) ? [["near:*", [relayer]]] : [],
      ),
    }),
    verify: async () => {
      throw new Error("not reached");
    },
    settle: async () => {
      throw new Error("not reached");
    },
  };
}

// An unpaid API request: no PAYMENT-SIGNATURE header, JSON accepted.
const unpaidRequest: HTTPAdapter = {
  getHeader: () => undefined,
  getMethod: () => "GET",
  getPath: () => "/weather",
  getUrl: () => "https://weather.example/weather",
  getAcceptHeader: () => "application/json",
  getUserAgent: () => "herald-test",
};

async function paymentRequiredFor(env: HeraldEnv) {
  const options = accepts({ providerAccount: "herald-test.near", price: "$0.01", env });
  // Type-level check: the output drops into a stock route config.
  const routes: RoutesConfig = { "GET /weather": { accepts: options, description: "Weather" } };

  const server = new x402ResourceServer(facilitatorFor(options.map((o) => o.network)))
    .register("eip155:*", new ExactEvmScheme())
    .register("solana:*", new ExactSvmScheme())
    .register("near:*", new ExactNearScheme());
  const httpServer = new x402HTTPResourceServer(server, routes);
  await httpServer.initialize();

  const result = await httpServer.processHTTPRequest({
    adapter: unpaidRequest,
    path: "/weather",
    method: "GET",
  });
  if (result.type !== "payment-error") throw new Error(`Expected a 402, got ${result.type}`);
  return result.response;
}

describe("accepts() with the stock x402ResourceServer", () => {
  test("builds a valid PAYMENT-REQUIRED 402 on mainnet", async () => {
    const response = await paymentRequiredFor("mainnet");

    expect(response.status).toBe(402);
    const header = response.headers["PAYMENT-REQUIRED"];
    expect(header).toBeDefined();
    const paymentRequired = PaymentRequiredSchema.parse(decodePaymentRequiredHeader(header ?? ""));

    expect(paymentRequired).toMatchObject({
      x402Version: 2,
      resource: { url: "https://weather.example/weather", description: "Weather" },
    });
    expect(paymentRequired.accepts).toMatchObject([
      {
        scheme: "exact",
        network: "near:mainnet",
        asset: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
        amount: "10000",
        payTo: "d49d0273509b7e40dae820590462736b7453aafbaf9ca1f133296667c1e933a1",
        maxTimeoutSeconds: 300,
        extra: {},
      },
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "10000",
        payTo: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "10000",
        payTo: "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq",
        maxTimeoutSeconds: 300,
        extra: { feePayer },
      },
      { network: "eip155:42161", asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
      { network: "eip155:137", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
      { network: "eip155:43114", asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
    ]);
  });

  test("builds a valid PAYMENT-REQUIRED 402 on testnet", async () => {
    const response = await paymentRequiredFor("testnet");

    expect(response.status).toBe(402);
    const paymentRequired = PaymentRequiredSchema.parse(
      decodePaymentRequiredHeader(response.headers["PAYMENT-REQUIRED"] ?? ""),
    );
    expect(paymentRequired.accepts).toMatchObject([
      {
        scheme: "exact",
        network: "near:testnet",
        asset: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
        amount: "10000",
        payTo: "dd8a6fceebf4d64665a1f0ee59ebdc07ac150515abdcb85640fe6ecb0033b73e",
        maxTimeoutSeconds: 300,
        // The stock NEAR server adds an empty `extra`; the relayer is never
        // part of the requirements.
        extra: {},
      },
      {
        network: "eip155:84532",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        amount: "10000",
        payTo: "0xddd22895f299b4aed54ebd6468a273e857d83296",
        extra: { name: "USDC", version: "2" },
      },
      {
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        payTo: "6hNg2qo9BhiG87haavYeqTEjqA4GgWZbAhEKihUqumPL",
        extra: { feePayer },
      },
      {
        network: "eip155:421614",
        asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
        extra: { name: "USD Coin", version: "2" },
      },
    ]);
  });
});
