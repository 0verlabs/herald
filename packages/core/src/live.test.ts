import { hexToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { describe, expect, test } from "vite-plus/test";
import {
  checkMpcRootKeys,
  deriveReceivingAddresses,
  mpcSigners,
  nearRpcMpcRootKeyReader,
  networkRegistry,
  receivingAddressPaths,
  unhandledKind,
  type HeraldEnv,
  type Network,
} from "./index.ts";

// Checks the pinned data against live chains. Opt-in, since it needs
// internet access: `vp run test:live` in packages/core sets HERALD_LIVE_CHECKS.
const enabled = Boolean(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .HERALD_LIVE_CHECKS,
);

// Public RPC endpoints, keyed by CAIP-2 network.
const rpcUrls: Record<string, string> = {
  "eip155:8453": "https://mainnet.base.org",
  "eip155:84532": "https://sepolia.base.org",
  "eip155:42161": "https://arb1.arbitrum.io/rpc",
  "eip155:421614": "https://sepolia-rollup.arbitrum.io/rpc",
  "eip155:137": "https://polygon-bor-rpc.publicnode.com",
  "eip155:43114": "https://api.avax.network/ext/bc/C/rpc",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com",
  "near:mainnet": "https://rpc.mainnet.fastnear.com",
  "near:testnet": "https://rpc.testnet.fastnear.com",
};
const nearRpcUrls: Record<HeraldEnv, string> = {
  mainnet: "https://rpc.mainnet.fastnear.com",
  testnet: "https://rpc.testnet.fastnear.com",
};

// NEAR methods take their params as an object, the others as an array.
async function jsonRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error !== undefined)
    throw new Error(`${method} on ${url}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/** A NEAR contract view at final finality, with its JSON result parsed. */
async function nearView(url: string, contractId: string, method: string, args: unknown) {
  const result = (await jsonRpc(url, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  })) as { result?: number[]; error?: string };
  if (!result.result) throw new Error(`${contractId}.${method} on ${url}: ${result.error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as unknown;
}

// ABI-decodes the return value of `name()` / `version()` (a single string).
function decodeString(hex: string): string {
  const bytes = Uint8Array.from(hex.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
  const length = Number(new DataView(bytes.buffer).getBigUint64(56));
  return new TextDecoder().decode(bytes.subarray(64, 64 + length));
}

async function readUsdc(network: Network) {
  const url = rpcUrls[network.caip2];
  if (!url) throw new Error(`No RPC URL for ${network.caip2}`);
  switch (network.kind) {
    case "evm": {
      const call = (data: string) =>
        jsonRpc(url, "eth_call", [{ to: network.usdc.address, data }, "latest"]) as Promise<string>;
      const [name, version, decimals] = await Promise.all([
        call("0x06fdde03"),
        call("0x54fd4d50"),
        call("0x313ce567"),
      ]);
      return {
        decimals: Number(BigInt(decimals)),
        eip712: { name: decodeString(name), version: decodeString(version) },
      };
    }
    case "solana": {
      const supply = (await jsonRpc(url, "getTokenSupply", [network.usdc.address])) as {
        value: { decimals: number };
      };
      return { decimals: supply.value.decimals };
    }
    case "near": {
      const metadata = (await nearView(url, network.usdc.address, "ft_metadata", {})) as {
        symbol: unknown;
        decimals: unknown;
      };
      return { symbol: metadata.symbol, decimals: metadata.decimals };
    }
    default:
      return unhandledKind(network);
  }
}

/** What Herald pins about a network's USDC, as `readUsdc` reads it from the chain. */
function pinnedUsdc(network: Network) {
  switch (network.kind) {
    case "evm":
      return { decimals: network.usdc.decimals, eip712: network.usdc.eip712 };
    case "solana":
      return { decimals: network.usdc.decimals };
    case "near":
      return { symbol: "USDC", decimals: network.usdc.decimals };
    default:
      return unhandledKind(network);
  }
}

const allNetworks = Object.values(networkRegistry).flat();

describe.runIf(enabled)("live: network registry", () => {
  test.each(allNetworks.map((network) => [network.label, network] as const))(
    "%s USDC matches its pinned on-chain metadata",
    async (_label, network) => {
      expect(await readUsdc(network)).toEqual(pinnedUsdc(network));
    },
    30_000,
  );
});

describe.runIf(enabled)("live: MPC root keys", () => {
  test.each(["mainnet", "testnet"] as const)(
    "the pinned %s root keys match the live contract",
    async (env) => {
      const check = await checkMpcRootKeys(env, nearRpcMpcRootKeyReader(nearRpcUrls[env]));
      expect(check).toEqual({ ok: true, mismatches: [] });
    },
    30_000,
  );
});

describe.runIf(enabled)("live: NEAR Receiving Address derivation", () => {
  test.each(["mainnet", "testnet"] as const)(
    "the offline near-1 derivation matches the %s signer's derived_public_key",
    async (env) => {
      const providerAccount = "herald-test.near";
      const { path, domainId } = receivingAddressPaths.near;
      const live = await nearView(
        nearRpcUrls[env],
        mpcSigners[env].contractId,
        "derived_public_key",
        { path, predecessor: providerAccount, domain_id: domainId },
      );
      const derived = deriveReceivingAddresses(providerAccount, env).near;
      expect(live).toBe(`ed25519:${base58.encode(hexToBytes(derived))}`);
    },
    30_000,
  );
});
