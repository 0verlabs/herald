import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  getProviderBalances,
  registerProvider,
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

  test("returns null for an id no Provider has", async () => {
    expect(
      await getProviderBalances(
        { db: db(), readUsdcBalance: fakeChains({}) },
        { providerId: 999_999, env: "testnet" },
      ),
    ).toBeNull();
  });
});
