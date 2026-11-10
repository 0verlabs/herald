import {
  ChainNameSchema,
  chainRegistry,
  deriveReceivingAddresses,
  NearAccountIdSchema,
  NetworkSchema,
  PriceSchema,
  priceToBaseUnits,
  type CaipNetwork,
  type ChainName,
  type Network,
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
  network: NetworkSchema.default("mainnet"),
  chains: z.array(ChainNameSchema).min(1, "chains must list at least one chain").optional(),
});

export type AcceptsOptions = {
  /** The NEAR account that controls the Receiving Addresses, e.g. `"alice.near"`. */
  providerAccount: string;
  /** USD Price per request, e.g. `"$0.01"`. The same on every Payment Option. */
  price: string;
  /** Which Herald network to take payments on. Defaults to `"mainnet"`. */
  network?: Network;
  /**
   * Only offer these chains. Order is always Herald's (Base, Solana,
   * Arbitrum, Polygon, Avalanche). Chains the network doesn't list are
   * skipped, so the same list works on testnet.
   */
  chains?: ChainName[];
};

export type PaymentOption = {
  scheme: "exact";
  network: CaipNetwork;
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
 * One `exact` USDC option per chain, paying into the Provider's Receiving
 * Addresses. Synchronous and pure: the addresses are derived offline from the
 * pinned MPC root keys, with no network calls. Throws a `TypeError` on an
 * invalid account id, price, network or chain list.
 */
export function accepts(options: AcceptsOptions): PaymentOption[] {
  const parsed = AcceptsOptionsSchema.safeParse(options);
  if (!parsed.success) throw new TypeError(formatError(parsed.error));
  const { providerAccount, price, network, chains } = parsed.data;

  const listed = chainRegistry[network].filter((chain) => !chains || chains.includes(chain.name));
  if (listed.length === 0) {
    throw new TypeError(
      `accepts(): none of ${chains?.join(", ")} is listed on ${network}, so no Payment Option is left`,
    );
  }

  const addresses = deriveReceivingAddresses(providerAccount, network);
  return listed.map((chain): PaymentOption => {
    const amount = priceToBaseUnits(price, chain.usdc.decimals);
    return chain.kind === "evm"
      ? {
          scheme: "exact",
          network: chain.network,
          payTo: addresses.evm,
          price: { asset: chain.usdc.address, amount, extra: { ...chain.usdc.eip712 } },
          maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        }
      : {
          scheme: "exact",
          network: chain.network,
          payTo: addresses.solana,
          price: { asset: chain.usdc.address, amount },
          maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        };
  });
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
