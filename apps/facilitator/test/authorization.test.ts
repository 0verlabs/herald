import { revokeApiKey } from "@herald/core/server";
import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { FACILITATOR_URL, installFakeNetwork } from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const network = "eip155:84532";

describe("API key checks on /verify and /settle", () => {
  test.each([
    ["no key", () => Promise.resolve(undefined), "missing_api_key"],
    ["an unknown key", () => Promise.resolve("hk_test_NotAKeyHeraldIssued"), "invalid_api_key"],
    ["a key that isn't Herald's", () => Promise.resolve("sk_live_123"), "invalid_api_key"],
    [
      "a revoked key",
      async () => {
        const { provider, apiKey, secret } = await registeredProvider("revoked-key.testnet");
        await revokeApiKey(createDb(env.DB), { providerId: provider.id, apiKeyId: apiKey.id });
        return secret;
      },
      "revoked_api_key",
    ],
    [
      "a mainnet key on the testnet facilitator",
      async () => (await registeredProvider("live-key.testnet", "mainnet")).secret,
      "wrong_environment_api_key",
    ],
  ])("rejects %s with 401 and submits nothing", async (_case, keyFor, error) => {
    const fake = installFakeNetwork();
    const payee = await registeredProvider("key-check-payee.testnet");
    const { payload, requirements } = await buyerPayment({
      providerAccount: "key-check-payee.testnet",
      network,
      apiKey: payee.secret,
    });
    const client = facilitatorClient(await keyFor());

    await expect(client.verify(payload, requirements)).rejects.toThrow(
      new RegExp(`Facilitator verify failed \\(401\\): .*"error":"${error}"`),
    );
    await expect(client.settle(payload, requirements)).rejects.toThrow(
      new RegExp(`Facilitator settle failed \\(401\\): .*"error":"${error}"`),
    );
    expect(fake.chains[network]?.submissions).toEqual([]);
  });
});

describe("request bodies", () => {
  test.each([
    ["null", "null"],
    ["not JSON", "x402"],
    ["x402 v1", JSON.stringify({ x402Version: 1, paymentPayload: {}, paymentRequirements: {} })],
    ["v2 without a payload", JSON.stringify({ x402Version: 2 })],
  ])("rejects a body that is %s with 400", async (_case, body) => {
    installFakeNetwork();
    const { secret } = await registeredProvider("bad-bodies.testnet");

    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("payTo checks", () => {
  test("rejects a payment into another Provider's Receiving Address with 403", async () => {
    const fake = installFakeNetwork();
    const other = await registeredProvider("someone-else.testnet");
    const { secret } = await registeredProvider("not-the-payee.testnet");
    // A payment to someone-else.testnet, presented with not-the-payee's key.
    const { payload, requirements } = await buyerPayment({
      providerAccount: "someone-else.testnet",
      network,
      apiKey: other.secret,
    });
    const client = facilitatorClient(secret);

    await expect(client.verify(payload, requirements)).rejects.toThrow(
      /Facilitator verify failed \(403\): .*"error":"pay_to_mismatch"/,
    );
    await expect(client.settle(payload, requirements)).rejects.toThrow(
      /Facilitator settle failed \(403\): .*"error":"pay_to_mismatch"/,
    );
    expect(fake.chains[network]?.submissions).toEqual([]);
  });
});
