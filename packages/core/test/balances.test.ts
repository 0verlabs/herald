import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { findNetwork } from "../src/index.ts";
import {
  getProviderBalances,
  registerProvider,
  rpcUsdcBalanceReader,
  type UsdcBalanceReader,
} from "../src/server/index.ts";

const db = () => createDb(env.DB);

/**
 * A fake set of chains: USDC balances in base units, keyed by
 * `<network>/<owner>`. An owner it has no balance for holds 0, as on a real
 * chain. Networks in `failing` answer with an error, like an RPC that's down.
 */
function fakeChains(balances: Record<string, string>, failing: string[] = []): UsdcBalanceReader {
  return async ({ network, owner }) => {
    if (failing.includes(network.caip2)) throw new Error(`${network.label} RPC is down`);
    return balances[`${network.caip2}/${owner}`] ?? "0";
  };
}

describe("getProviderBalances", () => {
  test("reads the USDC balance of the Receiving Address on every chain", async () => {
    const provider = await registerProvider(db(), {
      accountId: "balances-all.testnet",
      env: "testnet",
    });
    const readUsdcBalance = fakeChains({
      [`near:testnet/${provider.nearAddress}`]: "3000000",
      [`eip155:84532/${provider.evmAddress}`]: "1500000",
      [`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/${provider.solanaAddress}`]: "250000",
      [`eip155:421614/${provider.evmAddress}`]: "1",
      // Someone else's balance on the same chain.
      ["eip155:84532/0x000000000000000000000000000000000000b0b0"]: "999",
    });

    expect(
      await getProviderBalances(
        { db: db(), readUsdcBalance },
        { providerId: provider.id, env: "testnet" },
      ),
    ).toEqual([
      {
        network: "near:testnet",
        label: "NEAR Testnet",
        address: provider.nearAddress,
        ok: true,
        amount: "3000000",
      },
      {
        network: "eip155:84532",
        label: "Base Sepolia",
        address: provider.evmAddress,
        ok: true,
        amount: "1500000",
      },
      {
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        label: "Solana Devnet",
        address: provider.solanaAddress,
        ok: true,
        amount: "250000",
      },
      {
        network: "eip155:421614",
        label: "Arbitrum Sepolia",
        address: provider.evmAddress,
        ok: true,
        amount: "1",
      },
    ]);
  });

  test("shows an error for a chain whose RPC fails, and the other chains' balances", async () => {
    const provider = await registerProvider(db(), {
      accountId: "balances-failing.testnet",
      env: "testnet",
    });
    const readUsdcBalance = fakeChains(
      {
        [`eip155:84532/${provider.evmAddress}`]: "1500000",
        [`eip155:421614/${provider.evmAddress}`]: "42",
      },
      ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
    );

    const balances = await getProviderBalances(
      { db: db(), readUsdcBalance },
      { providerId: provider.id, env: "testnet" },
    );

    expect(balances).toMatchObject([
      { label: "NEAR Testnet", ok: true, amount: "0" },
      { label: "Base Sepolia", ok: true, amount: "1500000" },
      { label: "Solana Devnet", ok: false, address: provider.solanaAddress },
      { label: "Arbitrum Sepolia", ok: true, amount: "42" },
    ]);
    const solana = balances?.[2];
    expect(solana?.ok === false && solana.message).toContain("Solana Devnet");
  });

  test("doesn't wait forever on a chain whose RPC never answers", async () => {
    const provider = await registerProvider(db(), {
      accountId: "balances-hanging.testnet",
      env: "testnet",
    });
    const answering = fakeChains({ [`eip155:84532/${provider.evmAddress}`]: "5" });
    const readUsdcBalance: UsdcBalanceReader = (request) =>
      request.network.kind === "solana" ? new Promise(() => {}) : answering(request);

    const balances = await getProviderBalances(
      { db: db(), readUsdcBalance, timeoutMs: 50 },
      { providerId: provider.id, env: "testnet" },
    );

    expect(balances).toMatchObject([
      { label: "NEAR Testnet", ok: true, amount: "0" },
      { label: "Base Sepolia", ok: true, amount: "5" },
      { label: "Solana Devnet", ok: false },
      { label: "Arbitrum Sepolia", ok: true, amount: "0" },
    ]);
  });

  test("comes back without NEAR when its RPC never answers, and with every other chain", async () => {
    const provider = await registerProvider(db(), {
      accountId: "balances-near-hanging.testnet",
      env: "testnet",
    });
    const answering = fakeChains({ [`eip155:84532/${provider.evmAddress}`]: "7" });
    const readUsdcBalance: UsdcBalanceReader = (request) =>
      request.network.kind === "near" ? new Promise(() => {}) : answering(request);

    const balances = await getProviderBalances(
      { db: db(), readUsdcBalance, timeoutMs: 50 },
      { providerId: provider.id, env: "testnet" },
    );

    expect(balances).toMatchObject([
      { label: "NEAR Testnet", ok: false, address: provider.nearAddress },
      { label: "Base Sepolia", ok: true, amount: "7" },
      { label: "Solana Devnet", ok: true, amount: "0" },
      { label: "Arbitrum Sepolia", ok: true, amount: "0" },
    ]);
  });

  test("returns null for an id no Provider has", async () => {
    expect(
      await getProviderBalances(
        { db: db(), readUsdcBalance: fakeChains({}) },
        { providerId: 999_999, env: "testnet" },
      ),
    ).toBeNull();
  });
});

// A private endpoint: the path stands in for an API key.
const NEAR_RPC_URL = "https://near-testnet.rpc.test/secret-api-key/";
const NEAR_TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const nearTestnet = () => {
  const network = findNetwork("near:testnet");
  if (!network) throw new Error("near:testnet isn't listed");
  return network;
};

/**
 * A fake NEAR RPC node holding Circle USDC on testnet: `usdc` maps account
 * ids to base units. It answers `ft_balance_of` views at final finality as
 * the contract does ("0" for an account it doesn't know), and anything else
 * the way a node answers a call it can't serve.
 */
function fakeNearRpc(usdc: Record<string, string>): typeof fetch {
  return async (url, init) => {
    const request = new Request(url, init);
    if (request.url !== NEAR_RPC_URL) throw new Error(`Unexpected request to ${request.url}`);
    const { id, method, params } = (await request.json()) as {
      id: unknown;
      method: string;
      params: Record<string, string>;
    };
    const answer = (body: object) => Response.json({ jsonrpc: "2.0", id, ...body });
    if (
      method !== "query" ||
      params.request_type !== "call_function" ||
      params.finality !== "final" ||
      params.account_id !== NEAR_TESTNET_USDC ||
      params.method_name !== "ft_balance_of"
    ) {
      return answer({ error: { name: "HANDLER_ERROR", code: -32000, message: "Server error" } });
    }
    const { account_id } = JSON.parse(atob(params.args_base64 ?? "")) as { account_id: string };
    const value = new TextEncoder().encode(JSON.stringify(usdc[account_id] ?? "0"));
    return answer({ result: { result: [...value], logs: [], block_height: 1, block_hash: "h" } });
  };
}

describe("rpcUsdcBalanceReader on NEAR", () => {
  const owner = "dd8a6fceebf4d64665a1f0ee59ebdc07ac150515abdcb85640fe6ecb0033b73e";

  test("reads the owner's USDC with ft_balance_of on the USDC contract", async () => {
    const read = rpcUsdcBalanceReader(
      { "near:testnet": NEAR_RPC_URL },
      fakeNearRpc({ [owner]: "1234567", ["someone-else.testnet"]: "99" }),
    );

    expect(await read({ network: nearTestnet(), owner })).toBe("1234567");
  });

  test("reads 0 for an account that never received USDC", async () => {
    const read = rpcUsdcBalanceReader({ "near:testnet": NEAR_RPC_URL }, fakeNearRpc({}));

    expect(await read({ network: nearTestnet(), owner })).toBe("0");
  });

  test("fails without naming the endpoint when the node can't answer", async () => {
    const down: typeof fetch = async () => new Response("Bad gateway", { status: 502 });
    // A runtime's own error can name the URL.
    const unreachable: typeof fetch = async () => {
      throw new TypeError(`fetch failed: ${NEAR_RPC_URL}`);
    };
    const panics: typeof fetch = async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { error: "wasm execution failed" } });

    for (const fetchFn of [down, unreachable, panics]) {
      const read = rpcUsdcBalanceReader({ "near:testnet": NEAR_RPC_URL }, fetchFn);
      const failure = await read({ network: nearTestnet(), owner }).then(
        () => expect.unreachable("the read should fail"),
        (error: unknown) => String(error),
      );
      expect(failure).toContain("NEAR Testnet");
      expect(failure).not.toContain("secret-api-key");
    }
  });
});
