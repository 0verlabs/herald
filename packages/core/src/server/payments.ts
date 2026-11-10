import { apiKeys, payments } from "@herald/db/schema";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { explorerTxUrl, networkRegistry, type Caip2, type Network } from "../networks.ts";
import { PaymentSchema, type HeraldEnv, type Payment, type Provider } from "../schemas.ts";
import type { Db } from "./db.ts";

export type ReceivingAddressRejection =
  | "unsupported_network"
  | "unsupported_asset"
  | "pay_to_mismatch";

export type ReceivingAddressCheck =
  | { ok: true; network: Network }
  | { ok: false; reason: ReceivingAddressRejection; message: string };

/**
 * Checks that an x402 payment requirement pays USDC into this Provider's own
 * Receiving Address (its `payTo`), on a network Herald lists in `env`. A
 * Provider's API key may only settle payments to itself.
 */
export function checkReceivingAddress(
  provider: Provider,
  env: HeraldEnv,
  requirement: { network: string; asset: string; payTo: string },
): ReceivingAddressCheck {
  const network = networkRegistry[env].find((n) => n.caip2 === requirement.network);
  if (!network) {
    return {
      ok: false,
      reason: "unsupported_network",
      message: `${requirement.network} is not a Herald network on ${env}.`,
    };
  }
  if (!sameAddress(network, requirement.asset, network.usdc.address)) {
    return {
      ok: false,
      reason: "unsupported_asset",
      message: `Herald settles only USDC (${network.usdc.address}) on ${network.label}.`,
    };
  }
  const receivingAddress = network.kind === "evm" ? provider.evmAddress : provider.solanaAddress;
  if (!sameAddress(network, requirement.payTo, receivingAddress)) {
    return {
      ok: false,
      reason: "pay_to_mismatch",
      message: `payTo must be ${provider.accountId}'s Receiving Address on ${network.label}, ${receivingAddress}.`,
    };
  }
  return { ok: true, network };
}

// EVM addresses compare case-insensitively (checksum casing is optional);
// Solana's base58 addresses are case-sensitive.
function sameAddress(network: Network, a: string, b: string): boolean {
  return network.kind === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

const NewPaymentSchema = PaymentSchema.omit({ id: true, settledAt: true });

/**
 * Records a payment settled now and marks the API key that settled it as
 * used, in one D1 batch. Recording the same transaction again returns the
 * existing row. Throws a `ZodError`, before writing anything, if the payment
 * doesn't fit `PaymentSchema`.
 */
export async function recordPayment(
  db: Db,
  input: Omit<Payment, "id" | "settledAt">,
): Promise<Payment> {
  const payment = NewPaymentSchema.parse(input);
  const settledAt = new Date();
  await db.batch([
    db
      .insert(payments)
      .values({ ...payment, settledAt })
      .onConflictDoNothing({ target: [payments.network, payments.txHash] }),
    db.update(apiKeys).set({ lastUsedAt: settledAt }).where(eq(apiKeys.id, payment.apiKeyId)),
  ]);
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.network, payment.network), eq(payments.txHash, payment.txHash)));
  return PaymentSchema.parse(row);
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** USDC revenue in base units, as decimal strings. */
export type RevenueTotals = { allTime: string; last7Days: string };

export type Revenue = {
  /** One entry per network Herald lists in the environment, in Payment Option order. */
  chains: (RevenueTotals & { network: Caip2; label: string })[];
  /** Every chain together. USDC is worth the same on each, so the totals add up. */
  total: RevenueTotals;
};

/**
 * A Provider's revenue from the payments Herald settled for it, per network
 * of `env`, all time and over the 7 days before `now` (default: the current
 * time). Networks without payments show zero.
 */
export async function getRevenue(
  db: Db,
  input: { providerId: number; env: HeraldEnv; now?: Date },
): Promise<Revenue> {
  const now = input.now ?? new Date();
  const since = now.getTime() - SEVEN_DAYS_MS;
  // `amount` is a decimal string of base units; SQLite sums it as a 64-bit
  // integer, and the cast back to text keeps the total exact in JS.
  const amount = sql`cast(${payments.amount} as integer)`;
  const rows = await db
    .select({
      network: payments.network,
      allTime: sql<string>`cast(sum(${amount}) as text)`,
      last7Days: sql<string>`cast(sum(case when ${payments.settledAt} >= ${since} then ${amount} else 0 end) as text)`,
    })
    .from(payments)
    .where(eq(payments.providerId, input.providerId))
    .groupBy(payments.network);

  const chains = networkRegistry[input.env].map((network) => {
    const row = rows.find((r) => r.network === network.caip2);
    return {
      network: network.caip2,
      label: network.label,
      allTime: row?.allTime ?? "0",
      last7Days: row?.last7Days ?? "0",
    };
  });
  const sum = (key: keyof RevenueTotals) =>
    chains.reduce((total, chain) => total + BigInt(chain[key]), 0n).toString();
  return { chains, total: { allTime: sum("allTime"), last7Days: sum("last7Days") } };
}

/** The most payments one page of the payment log holds. */
export const PAYMENT_LOG_MAX_PAGE_SIZE = 100;

const PaymentLogPageSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(PAYMENT_LOG_MAX_PAGE_SIZE),
});

/**
 * One payment in a Provider's payment log. `label` is the network's name and
 * `txUrl` its block explorer's page for the transaction; both are null for a
 * network Herald doesn't list in the environment.
 */
export type PaymentLogEntry = Pick<
  Payment,
  "id" | "network" | "asset" | "amount" | "buyerAddress" | "txHash" | "resourceUrl" | "settledAt"
> & { label: string | null; txUrl: string | null };

export type PaymentLogPage = {
  entries: PaymentLogEntry[];
  /** 1-based. */
  page: number;
  pageSize: number;
  /** How many payments the Provider has in all. */
  total: number;
  /** At least 1, so an empty log still has a first page. */
  pageCount: number;
};

/**
 * One page of the payments Herald settled for a Provider, newest first.
 * `page` is 1-based; a page past the last one is empty. Throws a `ZodError`
 * if `page` isn't a positive integer or `pageSize` isn't one up to
 * `PAYMENT_LOG_MAX_PAGE_SIZE`.
 */
export async function listPayments(
  db: Db,
  input: { providerId: number; env: HeraldEnv; page: number; pageSize: number },
): Promise<PaymentLogPage> {
  const { page, pageSize } = PaymentLogPageSchema.parse(input);
  const own = eq(payments.providerId, input.providerId);
  const [rows, [counted]] = await db.batch([
    db
      .select()
      .from(payments)
      .where(own)
      .orderBy(desc(payments.settledAt), desc(payments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(payments).where(own),
  ]);
  const total = counted?.total ?? 0;
  const networks = networkRegistry[input.env];
  return {
    entries: rows.map((row) => {
      const payment = PaymentSchema.parse(row);
      const network = networks.find((n) => n.caip2 === payment.network);
      return {
        id: payment.id,
        network: payment.network,
        label: network?.label ?? null,
        asset: payment.asset,
        amount: payment.amount,
        buyerAddress: payment.buyerAddress,
        txHash: payment.txHash,
        txUrl: network ? explorerTxUrl(network, payment.txHash) : null,
        resourceUrl: payment.resourceUrl,
        settledAt: payment.settledAt,
      };
    }),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
