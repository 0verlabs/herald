import { rpcUrlsFrom } from "@herald/core";
import {
  getProviderBalances,
  getProviderOverview,
  getRevenue,
  rpcUsdcBalanceReader,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
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
 * every chain, read from each chain's RPC: the facilitator's
 * `<CHAIN>_RPC_URL` secrets (see wrangler.jsonc). A chain that can't be
 * read comes back as an error for that chain only.
 */
export const getBalances = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const balances = await getProviderBalances(
      { db: createDb(env.DB), readUsdcBalance: rpcUsdcBalanceReader(rpcUrlsFrom(env)) },
      { providerId: context.session.providerId, env: readHeraldEnv() },
    );
    if (!balances) throw redirect({ to: "/sign-in" });
    return balances;
  });
