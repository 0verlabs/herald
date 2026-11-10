import { describe, expect, test } from "vite-plus/test";
import {
  checkMpcRootKeys,
  nearRpcMpcRootKeyReader,
  networkRegistry,
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
};
const nearRpcUrls: Record<HeraldEnv, string> = {
  mainnet: "https://rpc.mainnet.fastnear.com",
  testnet: "https://rpc.testnet.fastnear.com",
};

async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
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

// ABI-decodes the return value of `name()` / `version()` (a single string).
function decodeString(hex: string): string {
  const bytes = Uint8Array.from(hex.slice(2).match(/../g) ?? [], (b) => parseInt(b, 16));
  const length = Number(new DataView(bytes.buffer).getBigUint64(56));
  return new TextDecoder().decode(bytes.subarray(64, 64 + length));
}

async function readUsdc(network: Network) {
  const url = rpcUrls[network.caip2];
  if (!url) throw new Error(`No RPC URL for ${network.caip2}`);
  if (network.kind === "solana") {
    const supply = (await jsonRpc(url, "getTokenSupply", [network.usdc.address])) as {
      value: { decimals: number };
    };
    return { decimals: supply.value.decimals };
  }
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

const allNetworks = Object.values(networkRegistry).flat();

describe.runIf(enabled)("live: network registry", () => {
  test.each(allNetworks.map((network) => [network.label, network] as const))(
    "%s USDC matches its on-chain name(), version() and decimals()",
    async (_label, network) => {
      const expected =
        network.kind === "evm"
          ? { decimals: network.usdc.decimals, eip712: network.usdc.eip712 }
          : { decimals: network.usdc.decimals };
      expect(await readUsdc(network)).toEqual(expected);
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
