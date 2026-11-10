import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  authenticateApiKey,
  issueApiKey,
  listApiKeys,
  recordPayment,
  registerProvider,
  revokeApiKey,
} from "../src/server/index.ts";

const db = () => createDb(env.DB);

async function provider(accountId: string) {
  return registerProvider(db(), { accountId, env: "testnet" });
}

describe("issueApiKey", () => {
  test.each([
    { env: "testnet", start: "hk_test_" },
    { env: "mainnet", start: "hk_live_" },
  ] as const)("issues $start keys on $env, shown in full only once", async ({ env, start }) => {
    const alice = await provider(`keys-issue-${env}.testnet`);

    const { apiKey, secret } = await issueApiKey(db(), { providerId: alice.id, env });

    expect(secret.startsWith(start)).toBe(true);
    expect(apiKey).toMatchObject({
      providerId: alice.id,
      env,
      prefix: secret.slice(0, 12),
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(await listApiKeys(db(), { providerId: alice.id }))).not.toContain(secret);
  });

  test("issues a different key every time", async () => {
    const alice = await provider("keys-issue-unique.testnet");

    const first = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    const second = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });

    expect(first.secret).not.toEqual(second.secret);
  });
});

describe("listApiKeys", () => {
  test("lists a Provider's keys newest first, without the keys themselves", async () => {
    const alice = await provider("keys-list-alice.testnet");
    const first = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    const second = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });

    const keys = await listApiKeys(db(), { providerId: alice.id });

    expect(keys).toEqual([second.apiKey, first.apiKey]);
    expect(JSON.stringify(keys)).not.toContain(first.secret);
    expect(JSON.stringify(keys)).not.toContain(second.secret);
  });

  test("leaves out other Providers' keys", async () => {
    const alice = await provider("keys-list-own-alice.testnet");
    const bob = await provider("keys-list-own-bob.testnet");
    const own = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    await issueApiKey(db(), { providerId: bob.id, env: "testnet" });

    expect(await listApiKeys(db(), { providerId: alice.id })).toEqual([own.apiKey]);
  });

  test("is empty for a Provider with no keys", async () => {
    const alice = await provider("keys-list-empty.testnet");

    expect(await listApiKeys(db(), { providerId: alice.id })).toEqual([]);
  });

  test("shows when a key last settled a payment, and when it was revoked", async () => {
    const alice = await provider("keys-list-used.testnet");
    const used = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    const unused = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    const payment = await recordPayment(db(), {
      providerId: alice.id,
      apiKeyId: used.apiKey.id,
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "1000",
      buyerAddress: "0x000000000000000000000000000000000000b0b0",
      txHash: "0xkeys-list-used",
      resourceUrl: null,
    });
    await revokeApiKey(db(), { providerId: alice.id, apiKeyId: unused.apiKey.id });

    const [listedUnused, listedUsed] = await listApiKeys(db(), { providerId: alice.id });

    expect(listedUsed).toMatchObject({ id: used.apiKey.id, lastUsedAt: payment.settledAt });
    expect(listedUsed?.revokedAt).toBeNull();
    expect(listedUnused).toMatchObject({ id: unused.apiKey.id, lastUsedAt: null });
    expect(listedUnused?.revokedAt).toBeInstanceOf(Date);
  });
});

describe("revokeApiKey", () => {
  test("a revoked key stops authenticating at once", async () => {
    const alice = await provider("keys-revoke-alice.testnet");
    const { apiKey, secret } = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });

    expect(await revokeApiKey(db(), { providerId: alice.id, apiKeyId: apiKey.id })).toBe(true);

    expect(await authenticateApiKey(db(), { secret, env: "testnet" })).toMatchObject({
      ok: false,
      reason: "revoked",
    });
  });

  test("revoking a key twice reports false the second time", async () => {
    const alice = await provider("keys-revoke-twice.testnet");
    const { apiKey } = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });
    await revokeApiKey(db(), { providerId: alice.id, apiKeyId: apiKey.id });

    expect(await revokeApiKey(db(), { providerId: alice.id, apiKeyId: apiKey.id })).toBe(false);
  });

  test("a Provider can't revoke another Provider's key", async () => {
    const alice = await provider("keys-revoke-owner-alice.testnet");
    const mallory = await provider("keys-revoke-owner-mallory.testnet");
    const { apiKey, secret } = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });

    expect(await revokeApiKey(db(), { providerId: mallory.id, apiKeyId: apiKey.id })).toBe(false);

    expect(await authenticateApiKey(db(), { secret, env: "testnet" })).toMatchObject({ ok: true });
  });
});

describe("authenticateApiKey", () => {
  test("finds the Provider a key belongs to", async () => {
    const alice = await provider("keys-auth-alice.testnet");
    const { apiKey, secret } = await issueApiKey(db(), { providerId: alice.id, env: "testnet" });

    expect(await authenticateApiKey(db(), { secret, env: "testnet" })).toEqual({
      ok: true,
      apiKey,
      provider: alice,
    });
  });

  test.each([
    { case: "no key", secret: undefined, reason: "missing" },
    { case: "a key that isn't Herald's", secret: "sk_live_123", reason: "invalid" },
    {
      case: "a Herald-shaped key Herald never issued",
      secret: "hk_test_3vQB7B6MrGQZaxCuFg4oh",
      reason: "invalid",
    },
  ] as const)("rejects $case as $reason", async ({ secret, reason }) => {
    expect(await authenticateApiKey(db(), { secret, env: "testnet" })).toMatchObject({
      ok: false,
      reason,
    });
  });

  test.each([
    { keyEnv: "mainnet", facilitatorEnv: "testnet", accepted: "hk_test_" },
    { keyEnv: "testnet", facilitatorEnv: "mainnet", accepted: "hk_live_" },
  ] as const)(
    "rejects a $keyEnv key on the $facilitatorEnv facilitator",
    async ({ keyEnv, facilitatorEnv, accepted }) => {
      const alice = await provider(`keys-auth-env-${keyEnv}.testnet`);
      const { secret } = await issueApiKey(db(), { providerId: alice.id, env: keyEnv });

      const auth = await authenticateApiKey(db(), { secret, env: facilitatorEnv });

      expect(auth).toMatchObject({ ok: false, reason: "wrong_environment" });
      expect(auth.ok ? "" : auth.message).toContain(accepted);
    },
  );
});
