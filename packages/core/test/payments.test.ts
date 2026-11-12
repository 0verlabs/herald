import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  getRevenue,
  issueApiKey,
  listPayments,
  recordPayment,
  registerProvider,
} from "../src/server/index.ts";

const db = () => createDb(env.DB);

const BASE_SEPOLIA = "eip155:84532";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const SOLANA_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DAY_MS = 24 * 60 * 60 * 1000;

/** A testnet Provider with an API key, and a way to record payments it settled. */
async function providerWithKey(accountId: string) {
  const provider = await registerProvider(db(), { accountId, env: "testnet" });
  const { apiKey } = await issueApiKey(db(), { providerId: provider.id, env: "testnet" });
  let count = 0;
  const pay = (payment: { network: string; asset: string; amount: string; buyer?: string }) =>
    recordPayment(db(), {
      providerId: provider.id,
      apiKeyId: apiKey.id,
      network: payment.network as `${string}:${string}`,
      asset: payment.asset,
      amount: payment.amount,
      buyerAddress: payment.buyer ?? "0x000000000000000000000000000000000000b0b0",
      txHash: `0x${accountId}-${++count}`,
      resourceUrl: "https://api.example.com/weather",
    });
  return { provider, pay };
}

describe("getRevenue", () => {
  test("totals a Provider's payments per chain, all time and over the last 7 days", async () => {
    const { provider, pay } = await providerWithKey("revenue-totals.testnet");
    await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "10000" });
    await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "2500" });
    await pay({ network: SOLANA_DEVNET, asset: SOLANA_DEVNET_USDC, amount: "1" });

    expect(await getRevenue(db(), { providerId: provider.id, env: "testnet" })).toEqual({
      chains: [
        { network: "near:testnet", label: "NEAR Testnet", allTime: "0", last7Days: "0" },
        { network: BASE_SEPOLIA, label: "Base Sepolia", allTime: "12500", last7Days: "12500" },
        { network: SOLANA_DEVNET, label: "Solana Devnet", allTime: "1", last7Days: "1" },
        { network: "eip155:421614", label: "Arbitrum Sepolia", allTime: "0", last7Days: "0" },
      ],
      total: { allTime: "12501", last7Days: "12501" },
    });
  });

  test("leaves payments settled more than 7 days ago out of the last 7 days", async () => {
    const { provider, pay } = await providerWithKey("revenue-window.testnet");
    await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "10000" });

    const sixDaysOn = await getRevenue(db(), {
      providerId: provider.id,
      env: "testnet",
      now: new Date(Date.now() + 6 * DAY_MS),
    });
    const eightDaysOn = await getRevenue(db(), {
      providerId: provider.id,
      env: "testnet",
      now: new Date(Date.now() + 8 * DAY_MS),
    });

    expect(sixDaysOn.total).toEqual({ allTime: "10000", last7Days: "10000" });
    expect(eightDaysOn.total).toEqual({ allTime: "10000", last7Days: "0" });
    expect(eightDaysOn.chains.find((chain) => chain.network === BASE_SEPOLIA)).toMatchObject({
      allTime: "10000",
      last7Days: "0",
    });
  });

  test("counts only the Provider's own payments", async () => {
    const alice = await providerWithKey("revenue-own-alice.testnet");
    const bob = await providerWithKey("revenue-own-bob.testnet");
    await alice.pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "700" });
    await bob.pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "900" });

    const revenue = await getRevenue(db(), { providerId: alice.provider.id, env: "testnet" });

    expect(revenue.total).toEqual({ allTime: "700", last7Days: "700" });
  });

  test("keeps totals exact past JavaScript's safe integer range", async () => {
    const { provider, pay } = await providerWithKey("revenue-large.testnet");
    // 2^53 + 1 base units: a float sum would round it to 2^53.
    await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "9007199254740992" });
    await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "1" });

    const revenue = await getRevenue(db(), { providerId: provider.id, env: "testnet" });

    expect(revenue.total.allTime).toBe("9007199254740993");
  });

  test("is zero on every chain for a Provider with no payments", async () => {
    const { provider } = await providerWithKey("revenue-none.testnet");

    expect(await getRevenue(db(), { providerId: provider.id, env: "testnet" })).toMatchObject({
      chains: [
        { label: "NEAR Testnet", allTime: "0", last7Days: "0" },
        { label: "Base Sepolia", allTime: "0", last7Days: "0" },
        { label: "Solana Devnet", allTime: "0", last7Days: "0" },
        { label: "Arbitrum Sepolia", allTime: "0", last7Days: "0" },
      ],
      total: { allTime: "0", last7Days: "0" },
    });
  });
});

describe("listPayments", () => {
  test("lists a Provider's payments newest first, with the chain and an explorer link", async () => {
    const { provider, pay } = await providerWithKey("log-entries.testnet");
    const evm = await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "10000" });
    const solana = await pay({
      network: SOLANA_DEVNET,
      asset: SOLANA_DEVNET_USDC,
      amount: "2500",
      buyer: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    });

    const log = await listPayments(db(), {
      providerId: provider.id,
      env: "testnet",
      page: 1,
      pageSize: 20,
    });

    expect(log).toEqual({
      entries: [
        {
          id: solana.id,
          network: SOLANA_DEVNET,
          label: "Solana Devnet",
          asset: SOLANA_DEVNET_USDC,
          amount: "2500",
          buyerAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          txHash: solana.txHash,
          txUrl: `https://explorer.solana.com/tx/${solana.txHash}?cluster=devnet`,
          resourceUrl: "https://api.example.com/weather",
          settledAt: solana.settledAt,
        },
        {
          id: evm.id,
          network: BASE_SEPOLIA,
          label: "Base Sepolia",
          asset: BASE_SEPOLIA_USDC,
          amount: "10000",
          buyerAddress: "0x000000000000000000000000000000000000b0b0",
          txHash: evm.txHash,
          txUrl: `https://sepolia.basescan.org/tx/${evm.txHash}`,
          resourceUrl: "https://api.example.com/weather",
          settledAt: evm.settledAt,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
      pageCount: 1,
    });
  });

  test("pages through the log, newest first, with an empty page past the end", async () => {
    const { provider, pay } = await providerWithKey("log-pages.testnet");
    const settled = [];
    for (const amount of ["1", "2", "3", "4", "5"]) {
      settled.push(await pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount }));
    }
    const page = (n: number) =>
      listPayments(db(), { providerId: provider.id, env: "testnet", page: n, pageSize: 2 });

    const [first, second, third, fourth] = await Promise.all([page(1), page(2), page(3), page(4)]);

    expect(first.entries.map((e) => e.amount)).toEqual(["5", "4"]);
    expect(second.entries.map((e) => e.amount)).toEqual(["3", "2"]);
    expect(third.entries.map((e) => e.amount)).toEqual(["1"]);
    expect(fourth.entries).toEqual([]);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5, pageCount: 3 });
    expect(fourth).toMatchObject({ page: 4, total: 5, pageCount: 3 });
  });

  test("lists only the Provider's own payments", async () => {
    const alice = await providerWithKey("log-own-alice.testnet");
    const bob = await providerWithKey("log-own-bob.testnet");
    const own = await alice.pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "7" });
    await bob.pay({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC, amount: "9" });

    const log = await listPayments(db(), {
      providerId: alice.provider.id,
      env: "testnet",
      page: 1,
      pageSize: 20,
    });

    expect(log.entries.map((e) => e.id)).toEqual([own.id]);
    expect(log.total).toBe(1);
  });

  test("has one empty page for a Provider with no payments", async () => {
    const { provider } = await providerWithKey("log-empty.testnet");

    expect(
      await listPayments(db(), { providerId: provider.id, env: "testnet", page: 1, pageSize: 20 }),
    ).toEqual({ entries: [], page: 1, pageSize: 20, total: 0, pageCount: 1 });
  });

  test.each([
    { case: "page 0", page: 0, pageSize: 20 },
    { case: "a fractional page", page: 1.5, pageSize: 20 },
    { case: "a page size over 100", page: 1, pageSize: 101 },
  ])("rejects $case", async ({ page, pageSize }) => {
    const { provider } = await providerWithKey(`log-reject-${page}-${pageSize}.testnet`);

    await expect(
      listPayments(db(), { providerId: provider.id, env: "testnet", page, pageSize }),
    ).rejects.toThrow();
  });
});
