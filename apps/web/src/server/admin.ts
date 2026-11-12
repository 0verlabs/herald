import { rpcUrlsFrom, SweepMinimumEditSchema, unhandledKind } from "@herald/core";
import {
  getGasWallets,
  listSweepMinimums,
  readAdminSession,
  rpcNativeBalanceReader,
  updateSweepMinimum,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { notFound } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { sessionToken } from "./auth";
import { evmGasWallet } from "./evm-chain-queue";
import { readHeraldEnv } from "./herald-env";
import { solanaSweepQueue } from "./solana-chain-queue";

// The admin page and its server functions are for the Herald admins in the
// HERALD_ADMINS allowlist (see wrangler.jsonc). Everyone else, signed in or
// not, gets a 404, so the page doesn't reveal that it exists.

/**
 * Loads the signed-in admin's session into `context.admin`, or answers 404.
 * Every admin server function uses it; the route guard only shapes
 * navigation.
 */
export const requireAdmin = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const admin = await readAdminSession(env.SESSIONS, sessionToken(), {
    admins: env.HERALD_ADMINS,
  });
  if (!admin) throw notFound();
  return next({ context: { admin } });
});

/** The signed-in admin's account. Answers 404 to anyone else. */
export const getAdminAccount = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(({ context }) => ({ accountId: context.admin.accountId }));

/**
 * Herald's gas wallet on every chain, with its native balance and a warning
 * below the GAS_LOW_BALANCE_THRESHOLDS var. The addresses come from the
 * facilitator's chain queues, which hold the keys; the balances from each
 * chain's `<CHAIN>_RPC_URL`. A chain that can't be read comes back as an
 * error for that chain only.
 */
export const getGasWalletStatuses = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(() => {
    const solana = solanaSweepQueue();
    return getGasWallets(
      {
        gasWalletAddress: (network) => {
          switch (network.kind) {
            case "evm":
              return evmGasWallet(network.caip2);
            case "solana":
              return solana.feePayer(network.caip2);
            default:
              return unhandledKind(network);
          }
        },
        readNativeBalance: rpcNativeBalanceReader(rpcUrlsFrom(env)),
      },
      { env: readHeraldEnv(), lowBalanceThresholds: env.GAS_LOW_BALANCE_THRESHOLDS },
    );
  });

/** The Sweep minimum of every chain in this Herald environment. */
export const getSweepMinimums = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(() => listSweepMinimums(createDb(env.DB), { env: readHeraldEnv() }));

/** Sets one chain's Sweep minimum and note. Sweeps use it from the next plan on. */
export const editSweepMinimum = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(SweepMinimumEditSchema)
  .handler(async ({ context, data }) => {
    const result = await updateSweepMinimum(createDb(env.DB), {
      env: readHeraldEnv(),
      edit: data,
    });
    if (result.ok) {
      console.log(
        JSON.stringify({
          event: "sweep_minimum_updated",
          account: context.admin.accountId,
          network: result.minimum.network,
          asset: result.minimum.asset,
          minimum: result.minimum.minimum,
        }),
      );
    }
    return result;
  });
