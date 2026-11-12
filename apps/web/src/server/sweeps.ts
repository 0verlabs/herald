import { rpcUrlsFrom } from "@herald/core";
import {
  completeSweep,
  discardSweep,
  getSweepOptions,
  nearRpcTransactionReader,
  planSweep,
  planSweepAll,
  refreshSweeps,
  rpcEvmReceiptReader,
  rpcNearSweepReader,
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
import { nearSweepQueue } from "./near-chain-queue";
import { oneClickClient } from "./one-click";
import { solanaSweepQueue } from "./solana-chain-queue";

// Every `env` read stays inside a server function or `createServerOnlyFn`
// (see herald-env.ts).

const readUsdcBalance = createServerOnlyFn(() => rpcUsdcBalanceReader(rpcUrlsFrom(env)));

// NEAR reads go to `NEAR_RPC_URL`; a relayer transaction is read with the
// relayer as its signer, which the NEAR chain queue names.
const readNear = createServerOnlyFn(() =>
  rpcNearSweepReader(env.NEAR_RPC_URL, (network) => nearSweepQueue().relayer(network)),
);

/**
 * What planning a Sweep reads: D1, balances, for Solana and NEAR the chain
 * (`SOLANA_RPC_URL`, `NEAR_RPC_URL`) and the facilitator's chain queue
 * (its fee payer or relayer), and 1Click's quotes for cross-chain and
 * Intents Sweeps.
 */
const planDeps = createServerOnlyFn((): SweepPlanDeps => ({
  db: createDb(env.DB),
  readUsdcBalance: readUsdcBalance(),
  readSolana: rpcSolanaSweepReader(rpcUrlsFrom(env)),
  solanaQueue: solanaSweepQueue(),
  readNear: readNear(),
  nearQueue: nearSweepQueue(),
  oneClick: oneClickClient(),
}));

/**
 * What completing and following Sweeps reads and writes: D1, the MPC
 * signature on NEAR (`NEAR_RPC_URL`), the facilitator's chain queues, each
 * chain's receipts, signature statuses or relayer transactions
 * (`<CHAIN>_RPC_URL`), and 1Click's status for cross-chain and Intents
 * Sweeps.
 */
const sweepDeps = createServerOnlyFn((): SweepDeps => ({
  db: createDb(env.DB),
  readNearTransaction: nearRpcTransactionReader(env.NEAR_RPC_URL),
  submitSweep: evmSweepSubmitter(),
  readReceipt: rpcEvmReceiptReader(rpcUrlsFrom(env)),
  readSolana: rpcSolanaSweepReader(rpcUrlsFrom(env)),
  solanaQueue: solanaSweepQueue(),
  readNear: readNear(),
  nearQueue: nearSweepQueue(),
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

const AddressInputSchema = z.string().max(64);

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
        destination: AddressInputSchema,
      }),
      z.object({
        destinationKind: z.literal("cross_chain"),
        network: z.string().max(64),
        amount: z.string().max(40),
        destinationNetwork: z.string().max(64),
        destination: AddressInputSchema,
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
 * Plans "Sweep all": one Sweep of the whole balance per chain holding at
 * least its minimum, each with its own MPC `sign` call for the wallet to
 * send in its own NEAR transaction. Chains that couldn't be planned come
 * back in `skipped` with the reason.
 */
export const startSweepAll = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(
    z.discriminatedUnion("destinationKind", [
      z.object({
        destinationKind: z.literal("same_chain"),
        evmDestination: AddressInputSchema.optional(),
        solanaDestination: AddressInputSchema.optional(),
        nearDestination: AddressInputSchema.optional(),
      }),
      z.object({
        destinationKind: z.literal("cross_chain"),
        destinationNetwork: z.string().max(64),
        destination: AddressInputSchema,
      }),
      z.object({ destinationKind: z.literal("intents") }),
    ]),
  )
  .handler(async ({ context, data }) => {
    const providerId = context.session.providerId;
    const plan = await planSweepAll(planDeps(), {
      providerId,
      env: readHeraldEnv(),
      target: data,
    });
    if (!plan.ok) {
      console.warn(
        JSON.stringify({
          event: "sweep_all_rejected",
          providerId,
          destinationKind: data.destinationKind,
          reason: plan.reason,
        }),
      );
      return { ok: false as const, reason: plan.reason, message: plan.message };
    }
    console.log(
      JSON.stringify({
        event: "sweep_all_planned",
        providerId,
        destinationKind: data.destinationKind,
        sweepIds: plan.planned.map(({ sweep }) => sweep.id),
        skipped: plan.skipped.map(({ network, reason }) => ({ network, reason })),
      }),
    );
    return {
      ok: true as const,
      planned: plan.planned.map(({ sweep, signRequest, quote }) => ({
        sweepId: sweep.id,
        network: sweep.sourceNetwork,
        amount: sweep.amount,
        signRequest,
        quote,
      })),
      skipped: plan.skipped,
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

/**
 * Discards a planned Sweep the signed-in Provider won't sign, such as a
 * 1Click quote they dropped or replaced, so it can't be signed later.
 */
export const discardPlannedSweep = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ sweepId: z.number().int().positive() }))
  .handler(async ({ context, data }) => ({
    discarded: await discardSweep(createDb(env.DB), {
      providerId: context.session.providerId,
      sweepId: data.sweepId,
    }),
  }));
