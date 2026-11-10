import { mpcSigners, networkRegistry, type Caip2 } from "@herald/core";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vite-plus/test";
import type { Address } from "viem";
import { createApp } from "../../src/app.ts";
import { FakeEvmChain } from "./fake-evm-chain.ts";

/** Where the in-process facilitator answers in tests. */
export const FACILITATOR_URL = "https://facilitator.test";

export type FakeNetwork = {
  /** One fake chain per EVM network in `RPC_URLS`, keyed by CAIP-2 id. */
  chains: Record<Caip2, FakeEvmChain>;
  /** Root keys the fake NEAR RPC reports for `v1.signer-prod.testnet`. */
  nearRootKeys: Record<number, string>;
};

/**
 * Replaces `fetch` for one test, inside the facilitator app and its chain
 * queue Durable Objects alike (they share the test's isolate):
 *
 * - `FACILITATOR_URL` goes to a fresh in-process facilitator app.
 * - Each EVM `RPC_URLS` endpoint goes to an in-memory `FakeEvmChain`, which
 *   stands in for the chain: reads, broadcast and receipts.
 * - `NEAR_RPC_URL` answers `public_key` with the pinned testnet root keys,
 *   unless a test changes `nearRootKeys`.
 *
 * Any other request fails the test.
 */
export function installFakeNetwork(): FakeNetwork {
  const app = createApp();
  const rpcUrls: Record<string, string> = env.RPC_URLS;
  const { rootKeys } = mpcSigners.testnet;
  const network: FakeNetwork = {
    chains: {},
    nearRootKeys: { 0: rootKeys.secp256k1, 1: rootKeys.ed25519 },
  };
  const chainsByUrl = new Map<string, FakeEvmChain>();
  for (const listed of networkRegistry.testnet) {
    const url = rpcUrls[listed.caip2];
    if (listed.kind !== "evm" || !url) continue;
    const chain = new FakeEvmChain(
      Number(listed.caip2.split(":")[1]),
      listed.usdc.address as Address,
    );
    network.chains[listed.caip2] = chain;
    chainsByUrl.set(new URL(url).href, chain);
  }

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(FACILITATOR_URL)) {
      return app.fetch(request, env, createExecutionContext());
    }
    const chain = chainsByUrl.get(request.url);
    if (chain) {
      const body: unknown = await request.json();
      const replies = Array.isArray(body)
        ? await Promise.all(body.map((call) => chain.handle(call)))
        : await chain.handle(body as Parameters<FakeEvmChain["handle"]>[0]);
      return Response.json(replies);
    }
    if (request.url === new URL(env.NEAR_RPC_URL).href) {
      const { params } = (await request.json()) as { params: { args_base64: string } };
      const { domain_id } = JSON.parse(atob(params.args_base64)) as { domain_id: number };
      const key = network.nearRootKeys[domain_id];
      const bytes = [...new TextEncoder().encode(JSON.stringify(key))];
      return Response.json({ jsonrpc: "2.0", id: "herald", result: { result: bytes, logs: [] } });
    }
    throw new Error(`Unexpected request in a facilitator test: ${request.method} ${request.url}`);
  });

  return network;
}
