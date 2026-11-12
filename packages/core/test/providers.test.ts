import { createDb, providers } from "@herald/db";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import {
  authenticateApiKey,
  getProviderOverview,
  issueApiKey,
  registerProvider,
  setNearSetupStatus,
  setSolanaTokenAccountStatus,
} from "../src/server/index.ts";

// `derived_public_key` for `herald-test.near` on path `near-1`, domain 1, as
// hex, recorded from the live MPC contracts on 2026-11-12.
const mainnetNear = "d49d0273509b7e40dae820590462736b7453aafbaf9ca1f133296667c1e933a1";
const testnetNear = "dd8a6fceebf4d64665a1f0ee59ebdc07ac150515abdcb85640fe6ecb0033b73e";

async function storedNearAddress(accountId: string) {
  const [row] = await createDb(env.DB)
    .select({ nearAddress: providers.nearAddress })
    .from(providers)
    .where(eq(providers.accountId, accountId));
  return row?.nearAddress;
}

describe("registerProvider", () => {
  test("stores the NEAR Receiving Address, an implicit account derived on near-1", async () => {
    const provider = await registerProvider(createDb(env.DB), {
      accountId: "herald-test.near",
      env: "mainnet",
    });

    expect(provider.nearAddress).toBe(mainnetNear);
    expect(await storedNearAddress("herald-test.near")).toBe(mainnetNear);
  });
});

describe("Providers registered before NEAR", () => {
  // As the NEAR migration leaves them: every column but near_address.
  async function legacyProvider(accountId: string) {
    const db = createDb(env.DB);
    const [row] = await db
      .insert(providers)
      .values({
        accountId,
        evmAddress: "0xddd22895f299b4aed54ebd6468a273e857d83296",
        solanaAddress: "6hNg2qo9BhiG87haavYeqTEjqA4GgWZbAhEKihUqumPL",
      })
      .returning();
    if (!row) throw new Error("No row inserted");
    return row;
  }

  test("get their NEAR Receiving Address when they sign in again", async () => {
    // herald-test.testnet has no fixture; the address is checked against the
    // testnet fixture below, so the row is herald-test.near's on testnet.
    const db = createDb(env.DB);
    await db.delete(providers).where(eq(providers.accountId, "herald-test.near"));
    await legacyProvider("herald-test.near");

    const provider = await registerProvider(db, { accountId: "herald-test.near", env: "testnet" });

    expect(provider.nearAddress).toBe(testnetNear);
    expect(await storedNearAddress("herald-test.near")).toBe(testnetNear);
    // Put back the mainnet row the other tests in this file expect.
    await db.delete(providers).where(eq(providers.accountId, "herald-test.near"));
    await registerProvider(db, { accountId: "herald-test.near", env: "mainnet" });
  });

  test("get their NEAR Receiving Address the first time their API key is used", async () => {
    const db = createDb(env.DB);
    const legacy = await legacyProvider("legacy-api-key.testnet");
    const { secret } = await issueApiKey(db, { providerId: legacy.id, env: "testnet" });

    const auth = await authenticateApiKey(db, { secret, env: "testnet" });

    const registered = await registerProvider(db, {
      accountId: "legacy-api-key.testnet",
      env: "testnet",
    });
    expect(auth).toMatchObject({ ok: true, provider: { nearAddress: registered.nearAddress } });
    expect(registered.nearAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(await storedNearAddress("legacy-api-key.testnet")).toBe(registered.nearAddress);
  });
});

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
      // Herald mainnet doesn't list NEAR yet.
      near: { address: mainnetNear, networks: [], setupStatus: "not_queued" },
    });
  });

  test("reports whether the NEAR Receiving Address is set up", async () => {
    const db = createDb(env.DB);
    const provider = await registerProvider(db, {
      accountId: "overview-near.testnet",
      env: "testnet",
    });
    const overview = () => getProviderOverview(db, { providerId: provider.id, env: "testnet" });

    expect(await overview()).toMatchObject({
      near: {
        address: provider.nearAddress,
        networks: ["NEAR Testnet"],
        setupStatus: "not_queued",
      },
    });
    await setNearSetupStatus(db, { providerId: provider.id, status: "created" });
    expect(await overview()).toMatchObject({ near: { setupStatus: "created" } });
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
