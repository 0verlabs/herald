import { sweeps } from "@herald/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { mpcSigners } from "../receiving-addresses.ts";
import { unhandledKind, type Caip2 } from "../networks.ts";
import { SweepSchema, type HeraldEnv, type Sweep } from "../schemas.ts";
import {
  mpcPayloadKey,
  readSponsoredSign,
  sponsoredSignPayload,
  type SponsoredSign,
  type SponsoredSignRequest,
} from "./sponsored-signs.ts";
import {
  discardSweep,
  getSweepOptions,
  planSweep,
  relaySponsoredSweep,
  signRequestFor,
  SWEEP_DAILY_CAP,
  type MpcSignRequest,
  type SponsoredSweepRelay,
  type SweepChainOption,
  type SweepDeps,
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

/**
 * How one Sweep of a sponsored "Sweep all" went (`relaySponsoredSweepAll`):
 * as `relaySponsoredSweep` answers for a single one, `not_signed` when the
 * wallet signed no delegate action for it, so it was discarded, or
 * `held_back` when a delegate action before it in nonce order went
 * unanswered, so it wasn't relayed yet and is safe to present again.
 * `delegate_refused` also answers a Sweep whose delegate action Herald
 * won't relay as a `sign` call at all (`readSponsoredSign`), saying why.
 */
export type SponsoredSweepAllOutcome = { sweepId: number } & (
  | SponsoredSweepRelay
  | { ok: false; reason: "not_signed" | "held_back"; message: string }
);

/**
 * Relays a sponsored "Sweep all" (ADR 0010): `signedDelegateActions` are
 * what the Provider's wallet signed in one `signDelegateActions` request
 * for the planned Sweeps `sweepIds`, one delegate action per Sweep holding
 * its one MPC `sign` call. Each delegate action is matched to its Sweep by
 * the payload it asks the MPC signer to sign, never by its position, and
 * relayed as `relaySponsoredSweep` relays a single one, in its own relayer
 * transaction (ADR 0008). Each Sweep completes or fails on its own.
 *
 * They are relayed one after the other in ascending nonce order, since a
 * delegate action landing after a higher-nonce one fails on NEAR. Solana's
 * goes first when the wallet numbered it first, as Meteor does for the
 * delegate action asked for first. After a relay goes unanswered, the
 * rest are held back (`held_back`) and stay `planned`: presenting the same
 * batch again is safe and relays them in order. A delegate action that
 * matches none of the Provider's Sweeps in `sweepIds` isn't relayed.
 *
 * A delegate action Herald won't relay as a `sign` call (a deposit other
 * than 1 yoctoNEAR, gas over the cap, another contract…) is refused
 * (`delegate_refused`) with why for the Sweep whose payload it holds,
 * which stays `planned` as for a single Sweep. A Sweep the wallet signed
 * no delegate action for is discarded (`not_signed`): signing sends
 * nothing, so it was never sent. When the batch holds a delegate action
 * so malformed Herald can't tell which Sweep it was for, the Sweeps left
 * without one are discarded too, but refused with its reason. Answers how
 * each Sweep went, in `sweepIds` order.
 */
export async function relaySponsoredSweepAll(
  deps: SweepDeps,
  input: {
    providerId: number;
    env: HeraldEnv;
    sweepIds: number[];
    signedDelegateActions: string[];
    now?: Date;
  },
): Promise<SponsoredSweepAllOutcome[]> {
  const own = await ownSweeps(deps, input);
  const sweepAsking = (payload: SponsoredSignRequest["payload_v2"]) =>
    own.find(
      (sweep) =>
        mpcPayloadKey(signRequestFor(input.env, sweep).args.request.payload_v2) ===
        mpcPayloadKey(payload),
    );
  const signs: SponsoredSign[] = [];
  const refused: Array<{ message: string; payload: SponsoredSignRequest["payload_v2"] | null }> =
    [];
  for (const signed of input.signedDelegateActions) {
    const read = readSponsoredSign(signed, mpcSigners[input.env].contractId);
    if (read.ok) signs.push(read.sign);
    else refused.push({ message: read.message, payload: sponsoredSignPayload(signed) });
  }
  // Ascending nonce order: landing a delegate action raises the key's nonce
  // to its own, so a lower one relayed after it fails on NEAR (#46).
  signs.sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0));

  const outcomes = new Map<number, SponsoredSweepAllOutcome>();
  let unanswered = false;
  for (const sign of signs) {
    const sweep = sweepAsking(sign.request.payload_v2);
    if (!sweep || outcomes.has(sweep.id)) continue;
    if (unanswered) {
      // Relayed now, it could land before the unanswered one and make it
      // fail on its nonce: it waits for the batch to be presented again.
      outcomes.set(sweep.id, {
        sweepId: sweep.id,
        ok: false,
        reason: "held_back",
        message: "Herald holds it back until the approval before it is relayed. Try again.",
      });
      continue;
    }
    const relayed = await relaySponsoredSweep(deps, {
      providerId: input.providerId,
      env: input.env,
      sweepId: sweep.id,
      signedDelegateAction: sign.signedDelegateAction,
      now: input.now,
    });
    unanswered = !relayed.ok && relayed.reason === "relay_unanswered";
    outcomes.set(sweep.id, { sweepId: sweep.id, ...relayed });
  }
  // A delegate action Herald won't relay says why for its Sweep, which
  // stays planned, as `relaySponsoredSweep` refuses one for a single Sweep.
  const unplaced: string[] = [];
  for (const { message, payload } of refused) {
    if (payload === null) {
      unplaced.push(message);
      continue;
    }
    const sweep = sweepAsking(payload);
    if (!sweep || outcomes.has(sweep.id)) continue;
    outcomes.set(sweep.id, { sweepId: sweep.id, ok: false, reason: "delegate_refused", message });
  }
  // Signing a delegate action sends nothing, so a Sweep the wallet signed
  // none for was never sent: discard it, as when a wallet stops partway.
  for (const sweep of own) {
    if (outcomes.has(sweep.id)) continue;
    await discardSweep(deps.db, { providerId: input.providerId, sweepId: sweep.id });
    outcomes.set(
      sweep.id,
      unplaced.length === 0
        ? {
            sweepId: sweep.id,
            ok: false,
            reason: "not_signed",
            message: "Your wallet didn't sign it, so Herald discarded it.",
          }
        : {
            sweepId: sweep.id,
            ok: false,
            reason: "delegate_refused",
            message: `${unplaced.join(" ")} Herald couldn't tell which Sweep that was for, so it discarded this one.`,
          },
    );
  }
  return input.sweepIds.map(
    (sweepId) =>
      outcomes.get(sweepId) ?? {
        sweepId,
        ok: false,
        reason: "unknown_sweep",
        message: "No such Sweep.",
      },
  );
}

/** The Provider's own Sweeps among `sweepIds`. */
async function ownSweeps(
  deps: Pick<SweepDeps, "db">,
  input: { providerId: number; sweepIds: number[] },
): Promise<Sweep[]> {
  if (input.sweepIds.length === 0) return [];
  const rows = await deps.db
    .select()
    .from(sweeps)
    .where(and(eq(sweeps.providerId, input.providerId), inArray(sweeps.id, input.sweepIds)));
  return rows.map((row) => SweepSchema.parse(row));
}
