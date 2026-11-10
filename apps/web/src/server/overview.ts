import {
  getProviderBalances,
  getProviderOverview,
  getRevenue,
  rpcUsdcBalanceReader,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requireSession } from "./auth";
import { readHeraldEnv } from "./herald-env";

/** The signed-in Provider's account, Receiving Addresses and revenue totals. */
export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const db = createDb(env.DB);
    const input = { providerId: context.session.providerId, env: readHeraldEnv() };
    const [overview, revenue] = await Promise.all([
      getProviderOverview(db, input),
      getRevenue(db, input),
    ]);
    if (!overview) throw redirect({ to: "/sign-in" });
    return { ...overview, revenue };
  });

/**
 * The live USDC balance of the signed-in Provider's Receiving Addresses on
 * every chain, read from each chain's RPC. A chain that can't be read comes
 * back as an error for that chain only.
 */
export const getBalances = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const balances = await getProviderBalances(
      { db: createDb(env.DB), readUsdcBalance: rpcUsdcBalanceReader(chainRpcUrls()) },
      { providerId: context.session.providerId, env: readHeraldEnv() },
    );
    if (!balances) throw redirect({ to: "/sign-in" });
    return balances;
  });

/**
 * Each chain's JSON-RPC endpoint, from the `<CHAIN>_RPC_URL` secrets (the
 * facilitator's, see wrangler.jsonc). Each Herald environment sets them to
 * its own networks: on testnet `BASE_RPC_URL` is Base Sepolia. Polygon and
 * Avalanche are mainnet only. Server only.
 */
const chainRpcUrls = createServerOnlyFn(() => ({
  "eip155:8453": env.BASE_RPC_URL,
  "eip155:84532": env.BASE_RPC_URL,
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": env.SOLANA_RPC_URL,
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": env.SOLANA_RPC_URL,
  "eip155:42161": env.ARBITRUM_RPC_URL,
  "eip155:421614": env.ARBITRUM_RPC_URL,
  "eip155:137": env.POLYGON_RPC_URL,
  "eip155:43114": env.AVALANCHE_RPC_URL,
}));
