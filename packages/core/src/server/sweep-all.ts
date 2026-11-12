import { unhandledKind, type Caip2 } from "../networks.ts";
import type { HeraldEnv, Sweep } from "../schemas.ts";
import {
  getSweepOptions,
  planSweep,
  SWEEP_DAILY_CAP,
  type MpcSignRequest,
  type SweepChainOption,
  type SweepPlanDeps,
  type SweepPlanRejection,
  type SweepQuote,
  type SweepTarget,
} from "./sweeps.ts";

/**
 * Where "Sweep all" sends each chain's USDC:
 *
 * - `same_chain`: to an address on the chain itself, `evmDestination` on
 *   every EVM chain, `solanaDestination` on Solana and `nearDestination`
 *   on NEAR. A kind of chain without one is left out.
 * - `cross_chain`: to `destination` on `destinationNetwork`. That chain
 *   Sweeps on itself (`same_chain`); the others go through 1Click.
 * - `intents`: into the Provider Account's NEAR Intents account.
 */
export type SweepAllTarget =
  | {
      destinationKind: "same_chain";
      evmDestination?: string;
      solanaDestination?: string;
      nearDestination?: string;
    }
  | { destinationKind: "cross_chain"; destinationNetwork: string; destination: string }
  | { destinationKind: "intents" };

/** One Sweep of a "Sweep all", planned and waiting for its own MPC signature. */
export type PlannedSweep = { sweep: Sweep; signRequest: MpcSignRequest; quote: SweepQuote | null };

/** A chain with enough USDC to Sweep that "Sweep all" couldn't plan, and why. */
export type SkippedChain = {
  network: Caip2;
  label: string;
  reason: SweepPlanRejection;
  message: string;
};

export type SweepAllPlan =
  | { ok: true; planned: PlannedSweep[]; skipped: SkippedChain[] }
  | { ok: false; reason: "unknown_provider" | "nothing_to_sweep"; message: string };

/**
 * Plans one Sweep of the whole balance from every chain of `env` holding at
 * least its minimum, in Payment Option order. Each is an ordinary planned
 * Sweep with its own MPC `sign` call and completes on its own (see
 * `completeSweep`), so each needs its own NEAR transaction: the MPC
 * network answers only a `sign` call that is alone in its transaction. A
 * chain that can't be planned, or that the daily cap leaves no room for,
 * is skipped with the reason; the others are planned anyway.
 */
export async function planSweepAll(
  deps: SweepPlanDeps,
  input: { providerId: number; env: HeraldEnv; target: SweepAllTarget; now?: Date },
): Promise<SweepAllPlan> {
  const options = await getSweepOptions(deps, input);
  if (!options)
    return { ok: false, reason: "unknown_provider", message: "No Provider has this id." };

  const sweepable = options.chains.flatMap((chain) => {
    const target = targetFor(chain, input.target);
    return target && worthSweeping(chain) ? [{ chain, target }] : [];
  });
  if (sweepable.length === 0) {
    return {
      ok: false,
      reason: "nothing_to_sweep",
      message: "No chain holds at least its minimum Sweep, so there's nothing to Sweep.",
    };
  }

  const outcomes = new Map<Caip2, PlannedSweep | SkippedChain>();
  const skip = (chain: SweepChainOption, reason: SweepPlanRejection, message: string) =>
    outcomes.set(chain.network, { network: chain.network, label: chain.label, reason, message });
  const waiting: Array<{ chain: SweepChainOption; target: SweepTarget; amount: string }> = [];
  for (const { chain, target } of sweepable) {
    if (chain.balance.ok) waiting.push({ chain, target, amount: chain.balance.amount });
    else skip(chain, "balance_unavailable", chain.balance.message);
  }

  // Plan as many chains as the daily cap leaves room for, all at once. A
  // chain that can't be planned frees its place for the next one.
  let room = Math.max(SWEEP_DAILY_CAP - options.submittedToday, 0);
  while (room > 0 && waiting.length > 0) {
    const batch = waiting.splice(0, room);
    const plans = await Promise.all(
      batch.map(({ chain, target, amount }) =>
        planSweep(deps, {
          providerId: input.providerId,
          env: input.env,
          network: chain.network,
          amount,
          now: input.now,
          ...target,
        }),
      ),
    );
    batch.forEach(({ chain }, index) => {
      const plan = plans[index];
      if (!plan?.ok) {
        if (plan) skip(chain, plan.reason, plan.message);
        return;
      }
      outcomes.set(chain.network, {
        sweep: plan.sweep,
        signRequest: plan.signRequest,
        quote: plan.quote,
      });
      room -= 1;
    });
  }
  for (const { chain } of waiting) {
    skip(
      chain,
      "daily_cap_reached",
      `Herald submits at most ${SWEEP_DAILY_CAP} Sweeps per Provider in 24 hours, so ${chain.label} has to wait.`,
    );
  }

  // Back in Payment Option order.
  const results = sweepable.flatMap(({ chain }) => outcomes.get(chain.network) ?? []);
  return {
    ok: true,
    planned: results.filter((r): r is PlannedSweep => "sweep" in r),
    skipped: results.filter((r): r is SkippedChain => !("sweep" in r)),
  };
}

/**
 * Whether a chain belongs in "Sweep all": it holds at least its minimum,
 * or Herald can Sweep there but its balance couldn't be read (so the
 * Provider hears why it was left out).
 */
function worthSweeping(chain: SweepChainOption): boolean {
  return chain.balance.ok ? chain.sweepAll : chain.minimum !== null;
}

function sameChainDestination(
  chain: SweepChainOption,
  target: Extract<SweepAllTarget, { destinationKind: "same_chain" }>,
): string | undefined {
  switch (chain.kind) {
    case "evm":
      return target.evmDestination;
    case "solana":
      return target.solanaDestination;
    case "near":
      return target.nearDestination;
    default:
      return unhandledKind(chain.kind);
  }
}

/** Where `target` sends this chain's USDC, or null if it leaves the chain out. */
function targetFor(chain: SweepChainOption, target: SweepAllTarget): SweepTarget | null {
  switch (target.destinationKind) {
    case "same_chain": {
      const destination = sameChainDestination(chain, target);
      return destination?.trim() ? { destinationKind: "same_chain", destination } : null;
    }
    case "cross_chain":
      return chain.network === target.destinationNetwork
        ? { destinationKind: "same_chain", destination: target.destination }
        : {
            destinationKind: "cross_chain",
            destinationNetwork: target.destinationNetwork,
            destination: target.destination,
          };
    case "intents":
      return { destinationKind: "intents" };
  }
}
