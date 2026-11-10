import { apiKeys, payments } from "@herald/db/schema";
import { eq } from "drizzle-orm";
import { networkRegistry, type Network } from "../networks.ts";
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
 * used, in one D1 batch. Throws a `ZodError`, before writing anything, if the
 * payment doesn't fit `PaymentSchema`.
 */
export async function recordPayment(
  db: Db,
  input: Omit<Payment, "id" | "settledAt">,
): Promise<Payment> {
  const payment = NewPaymentSchema.parse(input);
  const settledAt = new Date();
  const [inserted] = await db.batch([
    db
      .insert(payments)
      .values({ ...payment, settledAt })
      .returning(),
    db.update(apiKeys).set({ lastUsedAt: settledAt }).where(eq(apiKeys.id, payment.apiKeyId)),
  ]);
  return PaymentSchema.parse(inserted[0]);
}
