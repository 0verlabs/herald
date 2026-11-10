import { mpcSigners } from "@herald/core";
import { createDb, payments } from "@herald/db";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  FACILITATOR_URL,
  installFakeNetwork,
  SOLANA_DEVNET,
  type FakeNetwork,
} from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const network = "eip155:84532";

async function paidRequest(accountId: string) {
  const { provider, secret } = await registeredProvider(accountId);
  const payment = await buyerPayment({ providerAccount: accountId, network, apiKey: secret });
  return { provider, secret, ...payment, client: facilitatorClient(secret) };
}

async function paymentRows(providerId: number) {
  return createDb(env.DB).select().from(payments).where(eq(payments.providerId, providerId));
}

describe("no double settlement", () => {
  test("settling the same payment again fails without a second transaction", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await paidRequest("settle-twice.testnet");

    const first = await client.settle(payload, requirements);
    const second = await client.settle(payload, requirements);

    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: false,
      errorReason: "invalid_exact_evm_nonce_already_used",
    });
    expect(fake.chains[network]?.submissions).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });

  test("concurrent settlements of the same payment produce one transaction", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await paidRequest("settle-race.testnet");

    const results = await Promise.all(
      Array.from({ length: 3 }, () => client.settle(payload, requirements)),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(fake.chains[network]?.submissions).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });

  test("different payments get consecutive gas-wallet nonces", async () => {
    const fake = installFakeNetwork();
    const first = await paidRequest("nonce-one.testnet");
    const second = await paidRequest("nonce-two.testnet");

    const results = await Promise.all([
      first.client.settle(first.payload, first.requirements),
      second.client.settle(second.payload, second.requirements),
    ]);

    expect(results.map((result) => result.success)).toEqual([true, true]);
    // The queue keeps its nonce across tests in this file, so only the gap
    // between the two is fixed.
    const [lower = -1, higher] = (fake.chains[network]?.submissions ?? [])
      .map((s) => s.nonce)
      .sort((a, b) => a - b);
    expect(higher).toBe(lower + 1);
  });
});

describe("no double settlement on Solana", () => {
  async function solanaPaidRequest(fake: FakeNetwork, accountId: string) {
    const { provider, secret } = await registeredProvider(accountId);
    await fake.solana.createTokenAccount(provider.solanaAddress);
    const payment = await buyerPayment({
      providerAccount: accountId,
      network: SOLANA_DEVNET,
      apiKey: secret,
    });
    return { provider, ...payment, client: facilitatorClient(secret) };
  }

  test("settling the same transaction again fails without sending it twice", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await solanaPaidRequest(
      fake,
      "solana-settle-twice.testnet",
    );

    const first = await client.settle(payload, requirements);
    const second = await client.settle(payload, requirements);

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, transaction: "" });
    expect(fake.solana.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });

  test("concurrent settlements of the same transaction produce one success", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await solanaPaidRequest(
      fake,
      "solana-settle-race.testnet",
    );

    const results = await Promise.all(
      Array.from({ length: 3 }, () => client.settle(payload, requirements)),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(fake.solana.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });
});

describe("rate limit", () => {
  test("allows 60 settlements per minute per API key, then answers 429", async () => {
    installFakeNetwork();
    const limited = await registeredProvider("rate-limited.testnet");
    const other = await registeredProvider("not-rate-limited.testnet");
    // Each attempt counts, so malformed bodies (rejected with 400 after the
    // limit check) are enough to use up the allowance.
    const settle = (secret: string) =>
      fetch(`${FACILITATOR_URL}/settle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: "{}",
      });

    for (let attempt = 1; attempt <= 60; attempt++) {
      const response = await settle(limited.secret);
      await response.body?.cancel();
      expect(response.status, `attempt ${attempt}`).toBe(400);
    }
    const over = await settle(limited.secret);

    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
    const unaffected = await settle(other.secret);
    await unaffected.body?.cancel();
    expect(unaffected.status).toBe(400);
  });
});

describe("verify rate limit", () => {
  test("allows 120 verifications per minute per API key, then answers 429", async () => {
    installFakeNetwork();
    const { secret } = await registeredProvider("verify-limited.testnet");
    const verify = () =>
      fetch(`${FACILITATOR_URL}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: "{}",
      });

    for (let attempt = 1; attempt <= 120; attempt++) {
      const response = await verify();
      await response.body?.cancel();
      expect(response.status, `attempt ${attempt}`).toBe(400);
    }
    const over = await verify();

    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("MPC root-key check", () => {
  test("refuses to settle when the live root keys don't match the pinned ones", async () => {
    const fake = installFakeNetwork();
    // The signer contract now reports a different ed25519 root key.
    fake.nearRootKeys[1] = mpcSigners.mainnet.rootKeys.ed25519;
    const { provider, payload, requirements, client } = await paidRequest("root-keys.testnet");

    await expect(client.settle(payload, requirements)).rejects.toThrow(
      /Facilitator settle failed \(503\): .*"error":"root_key_mismatch"/,
    );
    expect(fake.chains[network]?.submissions).toEqual([]);
    expect(await paymentRows(provider.id)).toEqual([]);
  });
});
