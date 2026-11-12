import { createDb, providers } from "@herald/db";
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, NEAR_TESTNET, nearRelayer } from "./support/network.ts";
import { registeredProvider, buyerPayment, facilitatorClient } from "./support/parties.ts";

// The NEAR chain queue's setup RPC, as the web Worker calls it through its
// cross-Worker Durable Object binding when a Provider signs in.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pastAnyBackoff = () => vi.setSystemTime(Date.now() + 15 * 60_000);

const queue = () => env.NEAR_CHAIN_QUEUE.getByName(NEAR_TESTNET);

async function statusOf(providerId: number) {
  const [row] = await createDb(env.DB)
    .select({ status: providers.nearSetupStatus })
    .from(providers)
    .where(eq(providers.id, providerId));
  return row?.status;
}

/**
 * Runs the queue's alarm until the Provider's NEAR Receiving Address
 * reaches `status`, moving the clock past any retry backoff before each run.
 */
async function processUntil(providerId: number, status: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (let run = 0; run < 10; run++) {
    await runDurableObjectAlarm(queue());
    if ((await statusOf(providerId)) === status) return;
    pastAnyBackoff();
  }
  expect(await statusOf(providerId)).toBe(status);
}

async function job(accountId: string) {
  const { provider } = await registeredProvider(accountId);
  return {
    provider,
    job: { network: NEAR_TESTNET, providerId: provider.id, account: provider.nearAddress },
  } as const;
}

describe("setting up a Provider's NEAR Receiving Address", () => {
  test("the relayer creates the account and registers it on USDC once, and it's recorded on the Provider", async () => {
    const fake = installFakeNetwork();
    const { provider, job: setup } = await job("near-setup-created.testnet");

    expect(await queue().queueSetup(setup)).toEqual({ ok: true });
    await processUntil(provider.id, "created");
    // Queued again, as a racing sign-in would: nothing more is sent.
    expect(await queue().queueSetup(setup)).toEqual({ ok: true });
    await runDurableObjectAlarm(queue());

    const relayer = nearRelayer().accountId;
    expect(fake.near.nearTransfers).toEqual([
      {
        txHash: expect.any(String),
        relayer,
        receiver: provider.nearAddress,
        amount: 2_000_000_000_000_000_000_000n,
        createdAccount: true,
      },
    ]);
    expect(fake.near.storageDeposits).toEqual([
      {
        txHash: expect.any(String),
        relayer,
        account: provider.nearAddress,
        deposit: 1_250_000_000_000_000_000_000n,
      },
    ]);
    expect(await statusOf(provider.id)).toBe("created");
  });

  test("an account that exists already is only registered on USDC", async () => {
    const fake = installFakeNetwork();
    const { provider, job: setup } = await job("near-setup-exists.testnet");
    fake.near.addAccount(provider.nearAddress, "ed25519:11111111111111111111111111111111", 1n);

    await queue().queueSetup(setup);
    await processUntil(provider.id, "created");

    expect(fake.near.nearTransfers).toEqual([]);
    expect(fake.near.storageDeposits.map((d) => d.account)).toEqual([provider.nearAddress]);
  });

  test("an account already set up is recorded without sending anything", async () => {
    const fake = installFakeNetwork();
    const { provider, job: setup } = await job("near-setup-done.testnet");
    fake.near.addAccount(provider.nearAddress, "ed25519:11111111111111111111111111111111", 1n);
    fake.near.registerStorage(provider.nearAddress);

    await queue().queueSetup(setup);
    await processUntil(provider.id, "created");

    expect(fake.near.nearTransfers).toEqual([]);
    expect(fake.near.storageDeposits).toEqual([]);
  });

  test("a failing RPC endpoint is retried until the account is set up", async () => {
    const fake = installFakeNetwork();
    fake.near.faults.failNextRequests = 2;
    const { provider, job: setup } = await job("near-setup-retried.testnet");

    await queue().queueSetup(setup);
    await processUntil(provider.id, "created");

    expect(fake.near.nearTransfers).toHaveLength(1);
    expect(fake.near.storageDeposits).toHaveLength(1);
  });

  test("a setup interrupted after the account was created resumes with the registration", async () => {
    const fake = installFakeNetwork();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { provider, job: setup } = await job("near-setup-resumed.testnet");
    await queue().queueSetup(setup);
    // The transfer lands, then reading the USDC registration fails.
    fake.near.faults.failNextCalls = { storage_balance_of: 1 };
    await runDurableObjectAlarm(queue());
    expect(fake.near.nearTransfers).toHaveLength(1);
    expect(fake.near.storageDeposits).toEqual([]);

    await processUntil(provider.id, "created");

    expect(fake.near.nearTransfers).toHaveLength(1);
    expect(fake.near.storageDeposits).toHaveLength(1);
  });

  test("after repeated failures the queue gives up, and queueing it again starts over", async () => {
    const fake = installFakeNetwork();
    fake.near.faults.failNextRequests = Number.POSITIVE_INFINITY;
    const { provider, job: setup } = await job("near-setup-gave-up.testnet");

    expect(await queue().queueSetup(setup)).toEqual({ ok: true });
    // Queued by its sign-in, as `ensureNearSetupQueued` marks it.
    await createDb(env.DB)
      .update(providers)
      .set({ nearSetupStatus: "queued" })
      .where(eq(providers.id, provider.id));
    await processUntil(provider.id, "not_queued");
    expect(fake.near.nearTransfers).toEqual([]);

    fake.near.faults.failNextRequests = 0;
    expect(await queue().queueSetup(setup)).toEqual({ ok: true });
    await processUntil(provider.id, "created");
    expect(fake.near.nearTransfers).toHaveLength(1);
  });

  test("refuses a network the queue doesn't serve", async () => {
    installFakeNetwork();
    const { job: setup } = await job("near-setup-wrong-network.testnet");

    expect(await queue().queueSetup({ ...setup, network: "near:mainnet" })).toEqual({
      ok: false,
      message: expect.stringMatching(/not a Herald NEAR network/),
    });
  });
});

describe("NEAR payments and the Receiving Address setup", () => {
  test("a payment is refused before setup and settles after it", async () => {
    const fake = installFakeNetwork();
    const accountId = "near-setup-pays.testnet";
    const { provider, secret } = await registeredProvider(accountId);
    const pay = () =>
      buyerPayment({
        providerAccount: accountId,
        network: NEAR_TESTNET,
        apiKey: secret,
        near: fake.near,
      });
    const client = facilitatorClient(secret);

    const before = await pay();
    expect(await client.settle(before.payload, before.requirements)).toMatchObject({
      success: false,
      errorReason: "invalid_exact_near_recipient_not_registered_for_storage",
    });
    // The facilitator didn't try to set the account up itself.
    expect(fake.near.nearTransfers).toEqual([]);
    expect(fake.near.storageDeposits).toEqual([]);

    await queue().queueSetup({
      network: NEAR_TESTNET,
      providerId: provider.id,
      account: provider.nearAddress,
    });
    await processUntil(provider.id, "created");
    vi.useRealTimers();

    const after = await pay();
    expect(await client.settle(after.payload, after.requirements)).toMatchObject({
      success: true,
      payer: after.buyer,
    });
    expect(fake.near.usdcBalanceOf(provider.nearAddress)).toBe(1000n);
  });
});
