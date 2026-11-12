import { mpcSigners, networkRegistry, rpcUrlsFrom, unhandledKind, type Caip2 } from "@herald/core";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vite-plus/test";
import type { Address } from "viem";
import { createApp } from "../../src/app.ts";
import { FakeEvmChain } from "./fake-evm-chain.ts";
import { FakeNearChain } from "./fake-near-chain.ts";
import { FakeSolanaChain } from "./fake-solana-chain.ts";

/** Where the in-process facilitator answers in tests. */
export const FACILITATOR_URL = "https://facilitator.test";

/** A second in-process facilitator app: another isolate, sharing the chain queues. */
export const OTHER_FACILITATOR_URL = "https://facilitator-2.test";

/** Herald testnet's Solana network, Solana Devnet. */
export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Herald testnet's NEAR network. */
export const NEAR_TESTNET = "near:testnet";

/** Where the stock Solana Buyer client reads Devnet by default. */
const STOCK_DEVNET_RPC_URL = "https://api.devnet.solana.com";

export type FakeNetwork = {
  /** One fake chain per Herald testnet EVM network, keyed by CAIP-2 id. */
  chains: Record<Caip2, FakeEvmChain>;
  /** The fake Solana Devnet cluster. */
  solana: FakeSolanaChain;
  /** The fake NEAR testnet, where Herald's relayer has a funded account. */
  near: FakeNearChain;
  /** Root keys the fake NEAR RPC reports for `v1.signer-prod.testnet`. */
  nearRootKeys: Record<number, string>;
};

/**
 * Herald's NEAR relayer, from the test's `NEAR_RELAYER_KEY`: its implicit
 * account id and public key.
 */
export function nearRelayer(): { accountId: string; publicKey: string } {
  if (!env.NEAR_RELAYER_KEY) throw new Error("Tests need NEAR_RELAYER_KEY (vite.config.ts)");
  const key = base58.decode(env.NEAR_RELAYER_KEY.replace(/^ed25519:/, ""));
  const publicKey = key.subarray(32);
  return { accountId: bytesToHex(publicKey), publicKey: `ed25519:${base58.encode(publicKey)}` };
}

type RpcHandler = { handle(call: never): Promise<unknown>; faults: { unreachable?: boolean } };

/**
 * Replaces `fetch` for one test, inside the facilitator app and its chain
 * queue Durable Objects alike (they share the test's isolate):
 *
 * - `FACILITATOR_URL` goes to a fresh in-process facilitator app, and
 *   `OTHER_FACILITATOR_URL` to another one, as a second isolate would.
 * - Each EVM network's `<CHAIN>_RPC_URL` endpoint goes to an in-memory
 *   `FakeEvmChain`, and `SOLANA_RPC_URL` to a `FakeSolanaChain`, as does
 *   the public Devnet
 *   endpoint the stock Solana Buyer client reads by default. They stand in
 *   for the chains: reads, broadcast and confirmations.
 * - `NEAR_RPC_URL` goes to a `FakeNearChain`, which also answers the MPC
 *   signer's `public_key` with the pinned testnet root keys, unless a test
 *   changes `nearRootKeys`.
 *
 * Any other request fails the test.
 *
 * `bindings` overrides the facilitator apps' bindings (not the chain queues'),
 * as a misconfigured deployment would have them.
 */
export function installFakeNetwork(
  options: { bindings?: Partial<CloudflareBindings> } = {},
): FakeNetwork {
  const appEnv: CloudflareBindings = { ...env, ...options.bindings };
  const app = createApp();
  const otherApp = createApp();
  const { contractId, rootKeys } = mpcSigners.testnet;
  const handlersByUrl = new Map<string, RpcHandler>();
  const chains: Record<Caip2, FakeEvmChain> = {};
  let solana: FakeSolanaChain | undefined;
  let near: FakeNearChain | undefined;
  const rpcUrls = rpcUrlsFrom(env);
  for (const listed of networkRegistry.testnet) {
    const configured = rpcUrls[listed.caip2];
    if (!configured) throw new Error(`No test RPC endpoint for ${listed.label}`);
    const url = new URL(configured).href;
    switch (listed.kind) {
      case "evm": {
        const chain = new FakeEvmChain(
          Number(listed.caip2.split(":")[1]),
          listed.usdc.address as Address,
        );
        chains[listed.caip2] = chain;
        handlersByUrl.set(url, chain);
        break;
      }
      case "solana":
        solana = new FakeSolanaChain(listed.usdc.address);
        handlersByUrl.set(url, solana);
        handlersByUrl.set(new URL(STOCK_DEVNET_RPC_URL).href, solana);
        break;
      case "near": {
        near = new FakeNearChain({
          usdc: listed.usdc.address,
          mpcContract: contractId,
          mpcRootKeys: { 0: rootKeys.secp256k1, 1: rootKeys.ed25519 },
        });
        const relayer = nearRelayer();
        near.addAccount(relayer.accountId, relayer.publicKey);
        handlersByUrl.set(url, near);
        break;
      }
      default:
        unhandledKind(listed);
    }
  }
  if (!solana) throw new Error("Herald testnet lists no Solana network");
  if (!near) throw new Error("Herald testnet lists no NEAR network");
  const network: FakeNetwork = { chains, solana, near, nearRootKeys: near.mpcRootKeys };

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(FACILITATOR_URL)) {
      return app.fetch(request, appEnv, createExecutionContext());
    }
    if (request.url.startsWith(OTHER_FACILITATOR_URL)) {
      return otherApp.fetch(request, appEnv, createExecutionContext());
    }
    const handler = handlersByUrl.get(request.url);
    if (handler?.faults.unreachable) {
      // As a runtime reports a refused connection, URL and all.
      throw new TypeError(`fetch failed: connect ECONNREFUSED ${request.url}`);
    }
    if (handler) {
      const body: unknown = await request.json();
      const replies = Array.isArray(body)
        ? await Promise.all(body.map((call) => handler.handle(call as never)))
        : await handler.handle(body as never);
      return Response.json(replies);
    }
    throw new Error(`Unexpected request in a facilitator test: ${request.method} ${request.url}`);
  });

  return network;
}
