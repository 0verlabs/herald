import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  getProviderOverview,
  registerProvider,
  setSolanaTokenAccountStatus,
} from "../src/server/index.ts";

describe("getProviderOverview", () => {
  test("lists each mainnet Receiving Address with the networks it receives on", async () => {
    const db = createDb(env.DB);
    const provider = await registerProvider(db, { accountId: "herald-test.near", env: "mainnet" });

    expect(await getProviderOverview(db, { providerId: provider.id, env: "mainnet" })).toEqual({
      accountId: "herald-test.near",
      evm: {
        address: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
        networks: ["Base", "Arbitrum", "Polygon", "Avalanche"],
      },
      solana: {
        address: "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq",
        networks: ["Solana"],
        tokenAccountStatus: "not_queued",
      },
    });
  });

  test("reports where the Solana USDC token account stands", async () => {
    const db = createDb(env.DB);
    const provider = await registerProvider(db, {
      accountId: "overview-token-account.testnet",
      env: "testnet",
    });
    await setSolanaTokenAccountStatus(db, { providerId: provider.id, status: "created" });

    expect(
      await getProviderOverview(db, { providerId: provider.id, env: "testnet" }),
    ).toMatchObject({ solana: { tokenAccountStatus: "created" } });
  });

  test("lists the testnet networks on testnet", async () => {
    const db = createDb(env.DB);
    const provider = await registerProvider(db, { accountId: "overview.testnet", env: "testnet" });

    expect(
      await getProviderOverview(db, { providerId: provider.id, env: "testnet" }),
    ).toMatchObject({
      accountId: "overview.testnet",
      evm: { networks: ["Base Sepolia", "Arbitrum Sepolia"] },
      solana: { networks: ["Solana Devnet"] },
    });
  });

  test("returns null for an id no Provider has", async () => {
    expect(
      await getProviderOverview(createDb(env.DB), { providerId: 999_999, env: "testnet" }),
    ).toBeNull();
  });
});
