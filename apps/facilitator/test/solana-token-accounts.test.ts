import { createDb, providers } from "@herald/db";
import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, SOLANA_DEVNET } from "./support/network.ts";
import { registeredProvider, solanaFeePayer } from "./support/parties.ts";

// The Solana chain queue's token-account RPC, as the web Worker calls it
// through its cross-Worker Durable Object binding when a Provider registers.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const pastAnyBackoff = () => vi.setSystemTime(Date.now() + 15 * 60_000);

const queue = () => env.SOLANA_CHAIN_QUEUE.getByName(SOLANA_DEVNET);

async function statusOf(providerId: number) {
  const [row] = await createDb(env.DB)
    .select({ status: providers.solanaTokenAccountStatus })
    .from(providers)
    .where(eq(providers.id, providerId));
  return row?.status;
}

/**
 * Runs the queue's alarm until the Provider's token account reaches
 * `status`, moving the clock past any retry backoff before each run.
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
    job: { network: SOLANA_DEVNET, providerId: provider.id, owner: provider.solanaAddress },
  } as const;
}

describe("creating a Provider's USDC token account", () => {
  test("Herald creates it once, paying the fee and rent, and records it on the Provider", async () => {
    const fake = installFakeNetwork();
    const { provider, job: creation } = await job("token-account-created.testnet");

    expect(await queue().queueTokenAccount(creation)).toEqual({ ok: true });
    await processUntil(provider.id, "created");
    // Queued again, as a racing sign-in would: nothing more is sent.
    expect(await queue().queueTokenAccount(creation)).toEqual({ ok: true });
    await runDurableObjectAlarm(queue());

    expect(fake.solana.tokenAccountCreations).toEqual([
      {
        signature: expect.any(String),
        feePayer: solanaFeePayer(),
        owner: provider.solanaAddress,
        tokenAccount: await fake.solana.tokenAccountOf(provider.solanaAddress),
      },
    ]);
    expect(await statusOf(provider.id)).toBe("created");
  });

  test("a token account that already exists is recorded without sending anything", async () => {
    const fake = installFakeNetwork();
    const { provider, job: creation } = await job("token-account-exists.testnet");
    await fake.solana.createTokenAccount(provider.solanaAddress);

    await queue().queueTokenAccount(creation);
    await processUntil(provider.id, "created");

    expect(fake.solana.tokenAccountCreations).toEqual([]);
  });

  test("a failing RPC endpoint is retried until the account is created", async () => {
    const fake = installFakeNetwork();
    fake.solana.faults.failNextRequests = 2;
    const { provider, job: creation } = await job("token-account-retried.testnet");

    await queue().queueTokenAccount(creation);
    await processUntil(provider.id, "created");

    expect(fake.solana.tokenAccountCreations).toHaveLength(1);
  });

  test("a failed attempt waits for its backoff, even when another account is queued", async () => {
    const fake = installFakeNetwork();
    vi.useFakeTimers({ toFake: ["Date"] });
    fake.solana.faults.failNextRequests = 1;
    const first = await job("token-account-backoff.testnet");
    await queue().queueTokenAccount(first.job);
    await runDurableObjectAlarm(queue());
    expect(fake.solana.tokenAccountCreations).toEqual([]);

    // A second Provider registers: only its account is attempted now.
    const second = await job("token-account-backoff-other.testnet");
    await queue().queueTokenAccount(second.job);
    await runDurableObjectAlarm(queue());
    expect(fake.solana.tokenAccountCreations.map((c) => c.owner)).toEqual([
      second.provider.solanaAddress,
    ]);

    pastAnyBackoff();
    await runDurableObjectAlarm(queue());
    expect(await statusOf(first.provider.id)).toBe("created");
  });

  test("after repeated failures the queue gives up and records it as failed", async () => {
    const fake = installFakeNetwork();
    fake.solana.faults.failNextRequests = Number.POSITIVE_INFINITY;
    const { provider, job: creation } = await job("token-account-gave-up.testnet");

    await queue().queueTokenAccount(creation);
    await processUntil(provider.id, "failed");

    expect(fake.solana.tokenAccountCreations).toEqual([]);
  });

  test("refuses a network the queue doesn't serve", async () => {
    installFakeNetwork();
    const { job: creation } = await job("token-account-wrong-network.testnet");

    expect(
      await queue().queueTokenAccount({
        ...creation,
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      }),
    ).toEqual({ ok: false, message: expect.stringMatching(/not a Herald Solana network/) });
  });
});
