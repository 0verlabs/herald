import { mpcSigners, networkRegistry, type Caip2 } from "@herald/core";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vite-plus/test";
import type { Address } from "viem";
import { createApp } from "../../src/app.ts";
import { rpcUrl } from "../../src/chains.ts";
import { FakeEvmChain } from "./fake-evm-chain.ts";
import { FakeSolanaChain } from "./fake-solana-chain.ts";

/** Where the in-process facilitator answers in tests. */
export const FACILITATOR_URL = "https://facilitator.test";

/** Herald testnet's Solana network, Solana Devnet. */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Where the stock Solana Buyer client reads Devnet by default. */
const STOCK_DEVNET_RPC_URL = "https://api.devnet.solana.com";

export type FakeNetwork = {
  /** One fake chain per Herald testnet EVM network, keyed by CAIP-2 id. */
  chains: Record<Caip2, FakeEvmChain>;
  /** The fake Solana Devnet cluster. */
  solana: FakeSolanaChain;
  /** Root keys the fake NEAR RPC reports for `v1.signer-prod.testnet`. */
  nearRootKeys: Record<number, string>;
};

type RpcHandler = { handle(call: never): Promise<unknown> };

/**
 * Replaces `fetch` for one test, inside the facilitator app and its chain
 * queue Durable Objects alike (they share the test's isolate):
 *
 * - `FACILITATOR_URL` goes to a fresh in-process facilitator app.
 * - Each EVM network's `<CHAIN>_RPC_URL` endpoint goes to an in-memory
 *   `FakeEvmChain`, and `SOLANA_RPC_URL` to a `FakeSolanaChain`, as does
 *   the public Devnet
 *   endpoint the stock Solana Buyer client reads by default. They stand in
 *   for the chains: reads, broadcast and confirmations.
 * - `NEAR_RPC_URL` answers `public_key` with the pinned testnet root keys,
 *   unless a test changes `nearRootKeys`.
 *
 * Any other request fails the test.
 */
export function installFakeNetwork(): FakeNetwork {
  const app = createApp();
  const { rootKeys } = mpcSigners.testnet;
  const handlersByUrl = new Map<string, RpcHandler>();
  const chains: Record<Caip2, FakeEvmChain> = {};
  let solana: FakeSolanaChain | undefined;
  for (const listed of networkRegistry.testnet) {
    const url = new URL(rpcUrl(env, listed.caip2)).href;
    if (listed.kind === "evm") {
      const chain = new FakeEvmChain(
        Number(listed.caip2.split(":")[1]),
        listed.usdc.address as Address,
      );
      chains[listed.caip2] = chain;
      handlersByUrl.set(url, chain);
    } else {
      solana = new FakeSolanaChain(listed.usdc.address);
      handlersByUrl.set(url, solana);
      handlersByUrl.set(new URL(STOCK_DEVNET_RPC_URL).href, solana);
    }
  }
  if (!solana) throw new Error("Herald testnet lists no Solana network");
  const network: FakeNetwork = {
    chains,
    solana,
    nearRootKeys: { 0: rootKeys.secp256k1, 1: rootKeys.ed25519 },
  };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(FACILITATOR_URL)) {
      return app.fetch(request, env, createExecutionContext());
    }
    const handler = handlersByUrl.get(request.url);
    if (handler) {
      const body: unknown = await request.json();
      const replies = Array.isArray(body)
        ? await Promise.all(body.map((call) => handler.handle(call as never)))
        : await handler.handle(body as never);
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
