import { USDC_DECIMALS } from "@herald/core";

/**
 * A stablecoin the dashboard shows. Every coin is pegged to the US dollar,
 * so the dashboard counts one coin as one dollar when it adds them up.
 */
export type Stablecoin = { symbol: string; name: string; decimals: number };

export const USDC: Stablecoin = { symbol: "USDC", name: "USD Coin", decimals: USDC_DECIMALS };

/**
 * The stablecoins customers can pay in, in display order. Herald settles
 * and reads USDC only today: a new coin goes here, and its balances come
 * back from the server next to USDC's.
 */
export const stablecoins: readonly Stablecoin[] = [USDC];

/** One network's share of a stablecoin balance. `amount` is null while it loads. */
export type NetworkHolding = {
  network: string;
  label: string;
  address?: string;
  amount: string | null;
  /** Why the balance couldn't be read, safe to show. */
  problem?: string;
};

/** A stablecoin's balance across every network, with the networks it sits on. */
export type StablecoinHolding = {
  coin: Stablecoin;
  /** The sum of the networks that could be read, in base units. */
  total: string;
  networks: NetworkHolding[];
  /** True while any network is still loading. */
  loading: boolean;
  /** How many networks couldn't be read. */
  unavailable: number;
};

/** Adds up one coin's balances across networks. */
export function holdingOf(coin: Stablecoin, networks: NetworkHolding[]): StablecoinHolding {
  const total = networks.reduce((sum, n) => sum + BigInt(n.amount ?? "0"), 0n);
  return {
    coin,
    total: total.toString(),
    networks,
    loading: networks.some((n) => n.amount === null && !n.problem),
    unavailable: networks.filter((n) => n.problem).length,
  };
}

/**
 * Every stablecoin's total in base units of the coin with the most
 * decimals, so coins with different decimals add up. With USDC alone it is
 * USDC's own total.
 */
export function totalAcross(holdings: StablecoinHolding[]): {
  baseUnits: string;
  decimals: number;
} {
  const decimals = Math.max(USDC_DECIMALS, ...holdings.map((h) => h.coin.decimals));
  const total = holdings.reduce(
    (sum, h) => sum + BigInt(h.total) * 10n ** BigInt(decimals - h.coin.decimals),
    0n,
  );
  return { baseUnits: total.toString(), decimals };
}
