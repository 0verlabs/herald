import { createDb, apiKeys, payments } from "@herald/db";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork } from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  ["Base Sepolia", "eip155:84532", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"],
  ["Arbitrum Sepolia", "eip155:421614", "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"],
] as const)("a Buyer pays on %s", (_label, network, usdc) => {
  test("the payment verifies, settles once into the Receiving Address and is recorded", async () => {
    const fake = installFakeNetwork();
    const accountId = `pays-${network.replace(":", "-")}.testnet`;
    const { provider, apiKey, secret } = await registeredProvider(accountId);
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
    const settled = await client.settle(payload, requirements);

    const chain = fake.chains[network];
    expect(chain?.submissions).toHaveLength(1);
    const [submission] = chain?.submissions ?? [];
    expect(settled).toEqual({
      success: true,
      transaction: submission?.hash,
      network,
      payer: buyer,
    });
    // Herald's gas wallet sent it; the USDC moved from the Buyer to the
    // Provider's Receiving Address.
    expect(submission?.sender).toBe(privateKeyToAccount(env.EVM_GAS_KEY as Hex).address);
    expect(submission?.from).toBe(buyer);
    expect(submission?.to.toLowerCase()).toBe(provider.evmAddress);

    const db = createDb(env.DB);
    expect(await db.select().from(payments).where(eq(payments.providerId, provider.id))).toEqual([
      {
        id: expect.any(Number),
        providerId: provider.id,
        apiKeyId: apiKey.id,
        network,
        asset: usdc,
        amount: "1000",
        buyerAddress: buyer,
        txHash: submission?.hash,
        resourceUrl: "https://weather.example/weather",
        settledAt: expect.any(Date),
      },
    ]);
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id));
    expect(key?.lastUsedAt).toBeInstanceOf(Date);
  });
});
