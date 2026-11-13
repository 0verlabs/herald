import { deriveReceivingAddresses } from "@herald/core";
import { createDb, providers } from "@herald/db";
import {
  createExecutionContext,
  createScheduledController,
  runDurableObjectAlarm,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, like } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import worker from "../src/index.ts";
import { installFakeNetwork, NEAR_TESTNET } from "./support/network.ts";
import { registeredProvider } from "./support/parties.ts";

// The facilitator's Cron Trigger queues the NEAR Receiving Address setup of
// every Provider that isn't on its way: those registered before NEAR, who
// may never sign in again, and those whose setup the queue gave up on.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const queue = () => env.NEAR_CHAIN_QUEUE.getByName(NEAR_TESTNET);

/** One run of the facilitator's Cron Trigger, as Cloudflare would start it. */
async function scheduledRun(bindings: Partial<CloudflareBindings> = {}) {
  const ctx = createExecutionContext();
  await worker.scheduled(
    createScheduledController({ cron: "*/10 * * * *" }),
    { ...env, ...bindings },
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

async function rowOf(accountId: string) {
  const [row] = await createDb(env.DB)
    .select()
    .from(providers)
    .where(eq(providers.accountId, accountId));
  if (!row) throw new Error(`No Provider ${accountId}`);
  return row;
}

/** Stores a Provider as it was before NEAR: no NEAR address, setup `not_queued`. */
async function providerFromBeforeNear(accountId: string) {
  const addresses = deriveReceivingAddresses(accountId, "testnet");
  await createDb(env.DB).insert(providers).values({
    accountId,
    evmAddress: addresses.evm,
    solanaAddress: addresses.solana,
    nearAddress: null,
  });
  return { ...(await rowOf(accountId)), derivedNearAddress: addresses.near };
}

/**
 * Runs the queue's alarm until the Provider's setup reaches `status`, moving
 * the clock past any retry backoff before each run.
 */
async function processUntil(accountId: string, status: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (let run = 0; run < 10; run++) {
    await runDurableObjectAlarm(queue());
    if ((await rowOf(accountId)).nearSetupStatus === status) return;
    vi.setSystemTime(Date.now() + 15 * 60_000);
  }
  expect((await rowOf(accountId)).nearSetupStatus).toBe(status);
}

describe("the scheduled NEAR setup run", () => {
  test("sets up a Provider registered before NEAR who never signs in again, once", async () => {
    const fake = installFakeNetwork();
    const before = await providerFromBeforeNear("near-cron-existing.testnet");

    await scheduledRun();

    const queued = await rowOf(before.accountId);
    expect(queued.nearAddress).toBe(before.derivedNearAddress);
    expect(queued.nearSetupStatus).toBe("queued");
    await processUntil(before.accountId, "created");
    // Later runs leave it alone.
    await scheduledRun();
    await runDurableObjectAlarm(queue());

    expect(fake.near.nearTransfers.map((t) => t.receiver)).toEqual([before.derivedNearAddress]);
    expect(fake.near.storageDeposits.map((d) => d.account)).toEqual([before.derivedNearAddress]);
    expect((await rowOf(before.accountId)).nearSetupStatus).toBe("created");
  });

  test("queues again a setup the queue gave up on, which then completes", async () => {
    const fake = installFakeNetwork();
    fake.near.faults.failNextRequests = Number.POSITIVE_INFINITY;
    const { provider } = await registeredProvider("near-cron-gave-up.testnet");

    await scheduledRun();
    await processUntil(provider.accountId, "not_queued");
    expect(fake.near.nearTransfers).toEqual([]);

    fake.near.faults.failNextRequests = 0;
    await scheduledRun();
    expect((await rowOf(provider.accountId)).nearSetupStatus).toBe("queued");
    await processUntil(provider.accountId, "created");

    expect(fake.near.nearTransfers.map((t) => t.receiver)).toEqual([provider.nearAddress]);
    expect(fake.near.storageDeposits.map((d) => d.account)).toEqual([provider.nearAddress]);
  });

  test("a Provider whose setup the queue can't take stays not_queued for the next run", async () => {
    installFakeNetwork();
    const { provider } = await registeredProvider("near-cron-unreachable.testnet");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await scheduledRun({
      NEAR_CHAIN_QUEUE: {
        getByName: () => {
          throw new Error("The NEAR chain queue is unreachable");
        },
      } as unknown as CloudflareBindings["NEAR_CHAIN_QUEUE"],
    });
    expect((await rowOf(provider.accountId)).nearSetupStatus).toBe("not_queued");

    await scheduledRun();
    await processUntil(provider.accountId, "created");
  });

  test("queues at most 50 Providers per run", async () => {
    installFakeNetwork();
    const db = createDb(env.DB);
    for (let i = 0; i < 51; i++) await registeredProvider(`near-cron-batch-${i}.testnet`);
    const notQueued = async () =>
      (
        await db
          .select({ id: providers.id })
          .from(providers)
          .where(eq(providers.nearSetupStatus, "not_queued"))
      ).length;
    const before = await notQueued();

    await scheduledRun();
    expect(await notQueued()).toBe(before - 50);

    for (let run = 0; run < 5 && (await notQueued()) > 0; run++) await scheduledRun();
    const batch = await db
      .select({ status: providers.nearSetupStatus })
      .from(providers)
      .where(like(providers.accountId, "near-cron-batch-%"));
    expect(batch.every((p) => p.status === "queued")).toBe(true);
  });
});
