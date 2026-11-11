import { rpcUrlsFrom } from "@herald/core";
import {
  completeSweep,
  getSweepOptions,
  nearRpcTransactionReader,
  planSweep,
  refreshSweeps,
  rpcEvmReceiptReader,
  rpcSolanaSweepReader,
  rpcUsdcBalanceReader,
  type SweepDeps,
  type SweepPlanDeps,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireSession } from "./auth";
import { evmSweepSubmitter } from "./evm-chain-queue";
import { readHeraldEnv } from "./herald-env";
import { oneClickClient } from "./one-click";
import { solanaSweepQueue } from "./solana-chain-queue";

// Every `env` read stays inside a server function or `createServerOnlyFn`
// (see herald-env.ts).

const readUsdcBalance = createServerOnlyFn(() => rpcUsdcBalanceReader(rpcUrlsFrom(env)));

/**
 * What planning a Sweep reads: D1, balances, for Solana the chain
 * (`SOLANA_RPC_URL`) and the facilitator's Solana chain queue (its fee
 * payer), and 1Click's quotes for cross-chain and Intents Sweeps.
 */
const planDeps = createServerOnlyFn((): SweepPlanDeps => ({
  db: createDb(env.DB),
  readUsdcBalance: readUsdcBalance(),
  readSolana: rpcSolanaSweepReader(rpcUrlsFrom(env)),
  solanaQueue: solanaSweepQueue(),
  oneClick: oneClickClient(),
}));

/**
 * What completing and following Sweeps reads and writes: D1, the MPC
 * signature on NEAR (`NEAR_RPC_URL`), the facilitator's chain queues, each
 * chain's receipts or signature statuses (`<CHAIN>_RPC_URL`), and 1Click's
 * status for cross-chain and Intents Sweeps.
 */
const sweepDeps = createServerOnlyFn((): SweepDeps => ({
  db: createDb(env.DB),
  readNearTransaction: nearRpcTransactionReader(env.NEAR_RPC_URL),
  submitSweep: evmSweepSubmitter(),
  readReceipt: rpcEvmReceiptReader(rpcUrlsFrom(env)),
  readSolana: rpcSolanaSweepReader(rpcUrlsFrom(env)),
  solanaQueue: solanaSweepQueue(),
  oneClick: oneClickClient(),
}));

/**
 * The chains the signed-in Provider can Sweep from, with live balances and
 * minimums, and how much of the daily cap is used.
 */
export const getSweepChoices = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const options = await getSweepOptions(
      { db: createDb(env.DB), readUsdcBalance: readUsdcBalance() },
      { providerId: context.session.providerId, env: readHeraldEnv() },
    );
    if (!options) throw redirect({ to: "/sign-in" });
    return options;
  });

/**
 * The signed-in Provider's latest Sweeps, newest first, after moving each
 * unfinished one on as far as it goes now.
 */
export const listSweeps = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) =>
    refreshSweeps(sweepDeps(), { providerId: context.session.providerId, env: readHeraldEnv() }),
  );

const address = z.string().max(64);

/**
 * Plans a Sweep and answers the NEAR call the Provider's wallet sends to
 * have the MPC signer sign it. For a cross-chain or Intents Sweep it also
 * answers the 1Click quote, for the Provider to check before signing.
 */
export const startSweep = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.discriminatedUnion("destinationKind", [
      z.object({
        destinationKind: z.literal("same_chain"),
        network: z.string().max(64),
        amount: z.string().max(40),
        destination: address,
      }),
      z.object({
        destinationKind: z.literal("cross_chain"),
        network: z.string().max(64),
        amount: z.string().max(40),
        destinationNetwork: z.string().max(64),
        destination: address,
      }),
      z.object({
        destinationKind: z.literal("intents"),
        network: z.string().max(64),
        amount: z.string().max(40),
      }),
    ]),
  )
  .handler(async ({ context, data }) => {
    const plan = await planSweep(planDeps(), {
      providerId: context.session.providerId,
      env: readHeraldEnv(),
      ...data,
    });
    if (!plan.ok) {
      console.warn(
        JSON.stringify({
          event: "sweep_plan_rejected",
          providerId: context.session.providerId,
          destinationKind: data.destinationKind,
          reason: plan.reason,
        }),
      );
      return { ok: false as const, reason: plan.reason, message: plan.message };
    }
    console.log(
      JSON.stringify({
        event: "sweep_planned",
        providerId: context.session.providerId,
        sweepId: plan.sweep.id,
        network: plan.sweep.sourceNetwork,
        destinationKind: plan.sweep.destinationKind,
        amount: plan.sweep.amount,
        oneClickQuoteId: plan.sweep.oneClickQuoteId,
      }),
    );
    return {
      ok: true as const,
      sweepId: plan.sweep.id,
      signRequest: plan.signRequest,
      quote: plan.quote,
    };
  });

/**
 * Takes the hash of the NEAR transaction in which the Provider's wallet had
 * the MPC signer sign a planned Sweep. Herald reads the signature from that
 * transaction and submits the transfer.
 */
export const finishSweep = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ sweepId: z.number().int().positive(), nearTxHash: z.string().max(64) }))
  .handler(async ({ context, data }) => {
    const result = await completeSweep(sweepDeps(), {
      providerId: context.session.providerId,
      env: readHeraldEnv(),
      ...data,
    });
    if (!result.ok) return { ok: false as const, message: result.message };
    return {
      ok: true as const,
      status: result.sweep.status,
      error: result.sweep.error,
      destinationKind: result.sweep.destinationKind,
    };
  });
