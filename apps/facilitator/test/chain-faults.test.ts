import { createDb, payments } from "@herald/db";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, SOLANA_DEVNET } from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

// The chain misbehaving the way real nodes do. SETTLE_RECEIPT_TIMEOUT_MS is
// 1.5 s in tests (vite.config.ts).

afterEach(() => {
  vi.restoreAllMocks();
});

const network = "eip155:84532";

async function paidRequest(accountId: string) {
  const { provider, secret } = await registeredProvider(accountId);
  const payment = await buyerPayment({ providerAccount: accountId, network, apiKey: secret });
  return { provider, ...payment, client: facilitatorClient(secret) };
}

async function paymentRows(providerId: number) {
  return createDb(env.DB).select().from(payments).where(eq(payments.providerId, providerId));
}

describe("a slow receipt", () => {
  test("the resource server's retry finds the pending transaction, and the payment is recorded", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    // Mined at once, but the receipt shows up only after the first wait.
    chain.faults.receiptDelayMs = 2_000;
    const { provider, payload, requirements, server } = await paidRequest("slow-receipt.testnet");

    // settlePayment is what the stock middleware calls. On settlement_pending
    // it asks the facilitator once more, here a fresh request and facilitator.
    const settled = await server.settlePayment(payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: chain.submissions[0]?.hash });
    expect(chain.submissions).toHaveLength(1);
    expect(await paymentRows(provider.id)).toMatchObject([{ txHash: chain.submissions[0]?.hash }]);
  });
});

describe("a slow Solana confirmation", () => {
  test("the resource server's retry finds the sent transaction, and the payment is recorded", async () => {
    const fake = installFakeNetwork();
    // Lands at once, but its status shows up only after the first wait.
    fake.solana.faults.confirmationDelayMs = 2_000;
    const accountId = "slow-solana-confirmation.testnet";
    const { provider, secret } = await registeredProvider(accountId);
    await fake.solana.createTokenAccount(provider.solanaAddress);
    const { payload, requirements, server } = await buyerPayment({
      providerAccount: accountId,
      network: SOLANA_DEVNET,
      apiKey: secret,
    });

    const settled = await server.settlePayment(payload, requirements);

    const [transfer] = fake.solana.transfers;
    expect(settled).toMatchObject({ success: true, transaction: transfer?.signature });
    expect(fake.solana.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toMatchObject([{ txHash: transfer?.signature }]);
  });
});

describe("a lost broadcast response", () => {
  test("a transaction the node accepted counts as sent, so the payment settles", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    chain.faults.loseNextBroadcastResponse = true;
    const { provider, payload, requirements, client } = await paidRequest("lost-response.testnet");

    const settled = await client.settle(payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: chain.submissions[0]?.hash });
    expect(chain.submissions).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });
});

describe("gas-wallet nonces", () => {
  test("a transaction the mempool dropped doesn't block later ones behind its nonce", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    chain.faults.dropNextBroadcast = true;
    const dropped = await paidRequest("dropped-tx.testnet");
    const next = await paidRequest("after-dropped-tx.testnet");

    const first = await dropped.client.settle(dropped.payload, dropped.requirements);
    const second = await next.client.settle(next.payload, next.requirements);

    expect(first).toMatchObject({ success: false, errorReason: "settlement_pending" });
    expect(second.success).toBe(true);
    expect(chain.submissions.map((s) => s.nonce)).toEqual([chain.dropped[0]?.nonce]);
  });

  test("a node that hasn't counted Herald's last transaction yet doesn't cause a nonce reuse", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    const first = await paidRequest("lagging-node-one.testnet");
    const second = await paidRequest("lagging-node-two.testnet");

    expect((await first.client.settle(first.payload, first.requirements)).success).toBe(true);
    // The endpoint answers from a node one transaction behind.
    chain.faults.pendingCountLag = 1;
    expect((await second.client.settle(second.payload, second.requirements)).success).toBe(true);

    const [a, b] = chain.submissions.map((s) => s.nonce);
    expect(b).toBe((a ?? -1) + 1);
  });
});
