import {
  Caip2Schema,
  deriveReceivingAddresses,
  HeraldEnvSchema,
  NearAccountIdSchema,
  networkRegistry,
  PriceSchema,
  priceToBaseUnits,
  type Caip2,
  type HeraldEnv,
} from "@herald/core";
import { z } from "zod";

/**
 * How long a Buyer's signed payment stays valid. Matches the stock
 * `x402ResourceServer` default, so the requirements it builds are the same
 * whether or not the option sets it.
 */
const MAX_TIMEOUT_SECONDS = 300;

const AcceptsOptionsSchema = z.object({
  providerAccount: NearAccountIdSchema,
  price: PriceSchema,
  env: HeraldEnvSchema.default("mainnet"),
  networks: z.array(Caip2Schema).min(1, "must list at least one network").optional(),
});

export type AcceptsOptions = {
  /** The NEAR account that controls the Receiving Addresses, e.g. `"alice.near"`. */
  providerAccount: string;
  /** USD Price per request, e.g. `"$0.01"`. The same on every Payment Option. */
  price: string;
  /** Which Herald environment to take payments on. Defaults to `"mainnet"`. */
  env?: HeraldEnv;
  /**
   * Only offer these CAIP-2 networks, e.g. `["eip155:8453"]`. Each must be
   * one Herald lists in `env`. Order is always Herald's (Base, Solana,
   * Arbitrum, Polygon, Avalanche).
   */
  networks?: Caip2[];
};

export type PaymentOption = {
  scheme: "exact";
  network: Caip2;
  payTo: string;
  price: { asset: string; amount: string; extra?: { name: string; version: string } };
  maxTimeoutSeconds: number;
};

/**
 * Herald's Payment Options for a Provider Account, ready for the `accepts`
 * field of any stock x402 v2 route config:
 *
 * ```ts
 * "GET /weather": { accepts: accepts({ providerAccount: "alice.near", price: "$0.01" }) }
 * ```
 *
 * One `exact` USDC option per network, paying into the Provider's Receiving
 * Addresses. Synchronous and pure: the addresses are derived offline from the
 * pinned MPC root keys, with no network calls. Throws a `TypeError` on an
 * invalid account id, price, environment or network list.
 */
export function accepts(options: AcceptsOptions): PaymentOption[] {
  const parsed = AcceptsOptionsSchema.safeParse(options);
  if (!parsed.success) throw new TypeError(formatError(parsed.error));
  const { providerAccount, price, env, networks } = parsed.data;

  const listed = networkRegistry[env];
  const unlisted = networks?.find((id) => !listed.some((network) => network.caip2 === id));
  if (unlisted) {
    throw new TypeError(
      `accepts(): ${unlisted} is not a Herald network on ${env} (${env} lists ${listed.map((n) => n.caip2).join(", ")})`,
    );
  }

  const addresses = deriveReceivingAddresses(providerAccount, env);
  return listed
    .filter((network) => !networks || networks.includes(network.caip2))
    .map((network) => ({
      scheme: "exact",
      network: network.caip2,
      payTo: addresses[network.kind],
      price: {
        asset: network.usdc.address,
        amount: priceToBaseUnits(price, network.usdc.decimals),
        ...(network.kind === "evm" && { extra: { ...network.usdc.eip712 } }),
      },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    }));
}

// One message per field: a short account id also fails the pattern, and
// "Invalid NEAR account id" twice reads worse than once.
function formatError(error: z.ZodError): string {
  const firstPerField = error.issues.filter(
    (issue, i, all) => all.findIndex((other) => other.path.join() === issue.path.join()) === i,
  );
  const issues = firstPerField.map((issue) => {
    const path = issue.path
      .map((key, i) =>
        typeof key === "number" ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`,
      )
      .join("");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return `accepts(): ${issues.join("; ")}`;
}
