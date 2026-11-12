import { createDb, payments } from "@herald/db";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  installFakeNetwork,
  NEAR_TESTNET,
  SOLANA_DEVNET,
  type FakeNetwork,
} from "./support/network.ts";
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

/** What the Provider's server sees from a facilitator call: its answer, or its error. */
async function seenByProvider(call: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await call());
  } catch (error) {
    return `${String(error)} ${JSON.stringify(error)}`;
  }
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

describe("a failing RPC endpoint", () => {
  // Herald's RPC endpoints are private URLs carrying an API key (the test
  // ones are in vite.config.ts). viem puts the URL in its error messages.
  const endpoint = "base-sepolia.rpc.test";

  /** The facilitator's answer, or its error, as the Provider's server sees it. */
  test("a broadcast the node refuses fails without naming the endpoint", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    chain.faults.rejectMethods = {
      methods: ["eth_sendRawTransaction"],
      message: "insufficient funds for gas * price + value",
    };
    const { payload, requirements, client } = await paidRequest("refused-broadcast.testnet");

    const seen = await seenByProvider(() => client.settle(payload, requirements));

    expect(seen).toContain('"success":false');
    expect(seen).not.toContain(endpoint);
    expect(chain.submissions).toHaveLength(0);
  });

  test("reads the node fails while verifying don't name the endpoint", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    const { payload, requirements, client } = await paidRequest("failing-reads.testnet");
    chain.faults.rejectMethods = {
      methods: ["eth_call", "eth_getCode", "eth_chainId", "eth_blockNumber"],
      message: "upstream unavailable",
    };

    const seen = await seenByProvider(() => client.verify(payload, requirements));

    expect(seen).not.toContain(endpoint);
  });

  test("an unreachable EVM endpoint isn't named, though the runtime's error names it", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    const { payload, requirements, client } = await paidRequest("unreachable-evm-rpc.testnet");
    chain.faults.unreachable = true;

    const seen = await seenByProvider(() => client.settle(payload, requirements));

    expect(seen).not.toContain(endpoint);
  });

  test("an unreachable Solana endpoint isn't named, though the runtime's error names it", async () => {
    const fake = installFakeNetwork();
    const accountId = "unreachable-solana-rpc.testnet";
    const { provider, secret } = await registeredProvider(accountId);
    await fake.solana.createTokenAccount(provider.solanaAddress);
    const { payload, requirements } = await buyerPayment({
      providerAccount: accountId,
      network: SOLANA_DEVNET,
      apiKey: secret,
    });
    fake.solana.faults.unreachable = true;

    const client = facilitatorClient(secret);
    const verified = await seenByProvider(() => client.verify(payload, requirements));
    const settled = await seenByProvider(() => client.settle(payload, requirements));

    expect(verified).not.toContain("solana-devnet.rpc.test");
    expect(settled).not.toContain("solana-devnet.rpc.test");
  });

  test("a failing Solana endpoint doesn't name itself either", async () => {
    const fake = installFakeNetwork();
    const accountId = "failing-solana-rpc.testnet";
    const { provider, secret } = await registeredProvider(accountId);
    await fake.solana.createTokenAccount(provider.solanaAddress);
    const { payload, requirements } = await buyerPayment({
      providerAccount: accountId,
      network: SOLANA_DEVNET,
      apiKey: secret,
    });
    fake.solana.faults.failNextRequests = 20;

    const seen = await seenByProvider(() =>
      facilitatorClient(secret).settle(payload, requirements),
    );

    expect(seen).not.toContain("solana-devnet.rpc.test");
  });

  test("reads the node fails while settling don't name the endpoint", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network];
    if (!chain) throw new Error("no fake chain");
    const { payload, requirements, client } = await paidRequest("failing-settle-reads.testnet");
    chain.faults.rejectMethods = {
      methods: ["eth_getTransactionCount", "eth_estimateGas", "eth_getBlockByNumber"],
      message: "upstream unavailable",
    };

    const seen = await seenByProvider(() => client.settle(payload, requirements));

    expect(seen).not.toContain(endpoint);
  });
});

describe("NEAR RPC faults", () => {
  async function nearPaidRequest(fake: FakeNetwork, accountId: string) {
    const { provider, secret } = await registeredProvider(accountId);
    fake.near.registerStorage(provider.nearAddress);
    const payment = await buyerPayment({
      providerAccount: accountId,
      network: NEAR_TESTNET,
      apiKey: secret,
      near: fake.near,
    });
    return { provider, ...payment, client: facilitatorClient(secret) };
  }

  test("a relayer transaction slow to be final still settles within the wait, and is recorded", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-slow-final.testnet",
    );
    fake.near.faults.finalityDelayMs = 700;

    const settled = await client.settle(payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: fake.near.transfers[0]?.txHash });
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });

  test("a relayer transaction final only after the wait: the resource server's retry finds it, and the payment is recorded", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, server } = await nearPaidRequest(
      fake,
      "near-final-after-wait.testnet",
    );
    // Lands at once, but is final only after the first wait (1.5 s).
    fake.near.faults.finalityDelayMs = 2_000;

    // settlePayment is what the stock middleware calls. On settlement_pending
    // it asks the facilitator once more, here a fresh request and facilitator.
    const settled = await server.settlePayment(payload, requirements);

    const [transfer] = fake.near.transfers;
    expect(settled).toMatchObject({ success: true, transaction: transfer?.txHash });
    expect(fake.near.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toMatchObject([{ txHash: transfer?.txHash }]);
  });

  test("a relayer transaction not final within the wait is pending, and is recorded once it is final", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-never-final.testnet",
    );
    fake.near.faults.finalityDelayMs = 60_000;

    const pending = await client.settle(payload, requirements);

    // It landed; the Provider's server hears which transaction to look up.
    const [transfer] = fake.near.transfers;
    expect(pending).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: transfer?.txHash,
    });
    expect(await paymentRows(provider.id)).toEqual([]);

    fake.near.faults.finalityDelayMs = 0;
    const settled = await client.settle(payload, requirements);
    const again = await client.settle(payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: transfer?.txHash });
    expect(again.success).toBe(false);
    expect(fake.near.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toMatchObject([{ txHash: transfer?.txHash }]);
  });

  test("a pending payment presented under another Provider's API key isn't recorded for it", async () => {
    const fake = installFakeNetwork();
    const { payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-pending-payee.testnet",
    );
    fake.near.faults.finalityDelayMs = 60_000;
    expect((await client.settle(payload, requirements)).errorReason).toBe("settlement_pending");
    const other = await registeredProvider("near-pending-other.testnet");
    fake.near.faults.finalityDelayMs = 0;

    const settled = await facilitatorClient(other.secret).settle(payload, {
      ...requirements,
      payTo: other.provider.nearAddress,
    });

    expect(settled.success).toBe(false);
    expect(await paymentRows(other.provider.id)).toEqual([]);
  });

  test("a broadcast the node doesn't take is sent again, and the payment settles once", async () => {
    const fake = installFakeNetwork();
    const { provider, payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-lost-broadcast.testnet",
    );
    fake.near.faults.failNextBroadcasts = 1;

    const settled = await client.settle(payload, requirements);

    expect(settled).toMatchObject({ success: true, transaction: fake.near.transfers[0]?.txHash });
    expect(fake.near.transfers).toHaveLength(1);
    expect(await paymentRows(provider.id)).toHaveLength(1);
  });

  test("an unreachable NEAR endpoint isn't named, though the runtime's error names it", async () => {
    const fake = installFakeNetwork();
    const { payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-unreachable-rpc.testnet",
    );
    fake.near.faults.unreachable = true;

    const verified = await seenByProvider(() => client.verify(payload, requirements));
    const settled = await seenByProvider(() => client.settle(payload, requirements));

    expect(verified).toContain('"isValid":false');
    expect(verified).not.toContain("near-testnet.rpc.test");
    expect(settled).not.toContain("near-testnet.rpc.test");
    expect(fake.near.transfers).toEqual([]);
  });

  test("a failing NEAR endpoint doesn't name itself either", async () => {
    const fake = installFakeNetwork();
    const { payload, requirements, client } = await nearPaidRequest(
      fake,
      "near-failing-rpc.testnet",
    );
    fake.near.faults.failNextRequests = 20;

    const verified = await seenByProvider(() => client.verify(payload, requirements));
    const settled = await seenByProvider(() => client.settle(payload, requirements));

    expect(verified).toContain('"isValid":false');
    expect(verified).not.toContain("near-testnet.rpc.test");
    expect(settled).not.toContain("near-testnet.rpc.test");
    expect(fake.near.transfers).toEqual([]);
  });
});
