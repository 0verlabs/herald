import { createDb, payments } from "@herald/db";
import { base58 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, NEAR_TESTNET, SOLANA_DEVNET } from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

// A facilitator deployed without a usable NEAR_RELAYER_KEY keeps serving
// every other chain. NEAR stays listed, so Providers' routes that offer it
// keep initializing, and NEAR payments are refused the stock way.

afterEach(() => {
  vi.restoreAllMocks();
});

// 64 random bytes: the right shape, but the second half isn't the public
// key of the first.
const mismatchedKey = `ed25519:${base58.encode(crypto.getRandomValues(new Uint8Array(64)))}`;

describe.each([
  ["missing", undefined],
  ["not a key", "ed25519:replace_me"],
  ["inconsistent", mismatchedKey],
] as const)("a NEAR_RELAYER_KEY that is %s", (label, relayerKey) => {
  const misconfigured = () => installFakeNetwork({ bindings: { NEAR_RELAYER_KEY: relayerKey } });
  const accountOf = (chain: string) => `no-relayer-${label.replace(/ /g, "-")}-${chain}.testnet`;

  test("/supported still lists every network, with no NEAR relayer", async () => {
    misconfigured();

    const supported = await facilitatorClient().getSupported();

    expect(supported.kinds.map(({ network }) => network)).toEqual([
      NEAR_TESTNET,
      "eip155:84532",
      SOLANA_DEVNET,
      "eip155:421614",
    ]);
    expect(supported.signers["near:*"] ?? []).toEqual([]);
  });

  test.each([
    ["Base Sepolia", "eip155:84532"],
    ["Solana Devnet", SOLANA_DEVNET],
  ] as const)("a payment on %s verifies and settles", async (chain, network) => {
    const fake = misconfigured();
    const accountId = accountOf(chain.replace(/ /g, "-").toLowerCase());
    const { provider, secret } = await registeredProvider(accountId);
    if (network === SOLANA_DEVNET) await fake.solana.createTokenAccount(provider.solanaAddress);
    const { payload, requirements, buyer } = await buyerPayment({
      providerAccount: accountId,
      network,
      apiKey: secret,
    });
    const client = facilitatorClient(secret);

    expect(await client.verify(payload, requirements)).toMatchObject({
      isValid: true,
      payer: buyer,
    });
    expect(await client.settle(payload, requirements)).toMatchObject({
      success: true,
      network,
      payer: buyer,
    });
    expect(
      await createDb(env.DB).select().from(payments).where(eq(payments.providerId, provider.id)),
    ).toHaveLength(1);
  });

  test("a NEAR payment is refused as having no relayer, nothing is sent, and the log says why without the key", async () => {
    const errors = vi.spyOn(console, "error");
    const fake = misconfigured();
    const accountId = accountOf("near");
    const { provider, secret } = await registeredProvider(accountId);
    fake.near.registerStorage(provider.nearAddress);
    const { payload, requirements } = await buyerPayment({
      providerAccount: accountId,
      network: NEAR_TESTNET,
      apiKey: secret,
      near: fake.near,
    });
    const client = facilitatorClient(secret);

    expect(await client.verify(payload, requirements)).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_near_no_relayer_configured",
    });
    expect(await client.settle(payload, requirements)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_near_no_relayer_configured",
    });
    expect(fake.near.transfers).toEqual([]);
    expect(
      await createDb(env.DB).select().from(payments).where(eq(payments.providerId, provider.id)),
    ).toEqual([]);

    const logged = errors.mock.calls.map((args) => args.join(" "));
    const unavailable = logged
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((entry) => entry?.event === "near_relayer_unavailable");
    expect(unavailable).toMatchObject({
      event: "near_relayer_unavailable",
      network: NEAR_TESTNET,
      message: expect.stringContaining("NEAR_RELAYER_KEY"),
    });
    if (relayerKey) {
      const secretPart = relayerKey.slice("ed25519:".length);
      expect(logged.some((line) => line.includes(secretPart))).toBe(false);
    }
  });
});
