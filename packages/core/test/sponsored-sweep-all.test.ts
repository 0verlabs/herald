import { createDb } from "@herald/db";
import { sweeps } from "@herald/db/schema";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { receivingAddressPaths } from "../src/index.ts";
import {
  planSweepAll,
  relaySponsoredSweepAll,
  type PlannedSweep,
  type SweepDeps,
  type UsdcBalanceReader,
} from "../src/server/index.ts";
import { nearKey } from "./support/near.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeNearUsdc,
  FakeOneClick,
  FakeSolana,
  fakeReceipts,
  solanaKeyPair,
  sweepingProvider,
  SYSTEM_PROGRAM,
  walletSignedSign,
} from "./support/sweeps.ts";

// A sponsored "Sweep all" (ADR 0010, #49): the Provider's wallet signs one
// delegate action per planned Sweep in one request, each holding that
// Sweep's one MPC `sign` call, and Herald's NEAR relayer sends each in its
// own transaction (ADR 0008), in ascending nonce order.

const db = () => createDb(env.DB);

const BASE_SEPOLIA = "eip155:84532";
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const NEAR_TESTNET = "near:testnet";
const EVM_DESTINATION = "0x000000000000000000000000000000000000d00d";
const NEAR_DESTINATION = "alice.testnet";

/** USDC balances by network; a network left out holds 0. */
function balancesByNetwork(balances: Record<string, string>): UsdcBalanceReader {
  return async ({ network }) => balances[network.caip2] ?? "0";
}

/**
 * A testnet Provider holding 2 USDC on Base Sepolia, Solana Devnet and NEAR
 * Testnet, its NEAR wallet's key, and fakes for everything outside Herald.
 * The fake NEAR's MPC signer signs relayed `sign` calls with the Receiving
 * Addresses' keys.
 */
async function sponsoredProvider(accountId: string) {
  const context = await sweepingProvider(accountId);
  const { provider } = context;
  const wallet = nearKey();
  const near = new FakeNear();
  near.derive(accountId, receivingAddressPaths.evm.path, context.receivingKey);
  near.derive(accountId, receivingAddressPaths.solana.path, context.solanaKey);
  near.derive(accountId, receivingAddressPaths.near.path, context.nearKey);
  const chain = new FakeChainQueue();
  const solana = new FakeSolana();
  await solana.addTokenAccount(provider.solanaAddress, DEVNET_USDC);
  const solanaDestination = solanaKeyPair().address;
  solana.accounts.set(solanaDestination, SYSTEM_PROGRAM);
  const nearUsdc = new FakeNearUsdc();
  nearUsdc.addAccount(provider.nearAddress);
  nearUsdc.registered.add(NEAR_DESTINATION);
  const oneClick = new FakeOneClick();
  const planDeps = {
    db: db(),
    readUsdcBalance: balancesByNetwork({
      [BASE_SEPOLIA]: "2000000",
      [SOLANA_DEVNET]: "2000000",
      [NEAR_TESTNET]: "2000000",
    }),
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: nearUsdc.reader,
    nearQueue: nearUsdc.queue,
    oneClick: oneClick.client,
  };
  const deps: SweepDeps = {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: chain.submit,
    readReceipt: fakeReceipts().read,
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: nearUsdc.reader,
    nearQueue: { ...nearUsdc.queue, submitSponsoredSign: near.relaySign },
    oneClick: oneClick.client,
  };
  const base = { providerId: provider.id, env: "testnet" as const };

  /** Plans "Sweep all" to the Provider's own wallets on each chain. */
  const planAll = async (): Promise<PlannedSweep[]> => {
    const plan = await planSweepAll(planDeps, {
      ...base,
      target: {
        destinationKind: "same_chain",
        evmDestination: EVM_DESTINATION,
        solanaDestination,
        nearDestination: NEAR_DESTINATION,
      },
    });
    if (!plan.ok) throw new Error(plan.message);
    return plan.planned;
  };
  /** The planned Sweep from `network`. */
  const from = (planned: PlannedSweep[], network: string): PlannedSweep => {
    const found = planned.find(({ sweep }) => sweep.sourceNetwork === network);
    if (!found) throw new Error(`Nothing planned from ${network}`);
    return found;
  };
  /**
   * The wallet's signed delegate actions for `planned`, one per Sweep, with
   * consecutive nonces in that order, as Meteor numbers them.
   */
  const signAll = (planned: PlannedSweep[], firstNonce = 1_000_001n) =>
    Promise.all(
      planned.map(({ signRequest }, index) =>
        walletSignedSign({
          accountId,
          key: wallet,
          request: signRequest,
          nonce: firstNonce + BigInt(index),
        }),
      ),
    );
  const relayAll = (planned: PlannedSweep[], signedDelegateActions: string[], now?: Date) =>
    relaySponsoredSweepAll(deps, {
      ...base,
      sweepIds: planned.map(({ sweep }) => sweep.id),
      signedDelegateActions,
      now,
    });
  const sweepRow = async (sweepId: number) =>
    (await db().select().from(sweeps).where(eq(sweeps.id, sweepId)))[0];
  return {
    ...context,
    wallet,
    near,
    chain,
    solana,
    nearUsdc,
    deps,
    base,
    planAll,
    from,
    signAll,
    relayAll,
    sweepRow,
  };
}

describe("a sponsored Sweep all", () => {
  test("relays each Sweep's delegate action in its own relayer transaction, and every Sweep reads its signature from it and submits its transfer", async () => {
    const { near, chain, solana, nearUsdc, planAll, signAll, relayAll } =
      await sponsoredProvider("sponsored-all.testnet");
    const planned = await planAll();
    expect(planned).toHaveLength(3);
    const signed = await signAll(planned);

    const outcomes = await relayAll(planned, signed);

    expect(outcomes).toEqual(
      planned.map(({ sweep }) =>
        expect.objectContaining({
          sweepId: sweep.id,
          ok: true,
          sweep: expect.objectContaining({ status: "submitted", nearTxRelayer: near.relayer }),
        }),
      ),
    );
    expect(near.sponsoredSubmissions).toHaveLength(3);
    const hashes = outcomes.map((o) => (o.ok ? o.sweep.nearTxHash : null));
    expect(new Set(hashes).size).toBe(3);
    expect(chain.submissions).toHaveLength(1);
    expect(solana.submissions).toHaveLength(1);
    expect(nearUsdc.submissions).toHaveLength(1);
  });

  test("relays the delegate actions in ascending nonce order, whatever order the wallet answers them in, so every one lands", async () => {
    const { near, planAll, signAll, relayAll } = await sponsoredProvider(
      "sponsored-all-nonces.testnet",
    );
    near.checkNonces = true;
    const planned = await planAll();
    const signed = await signAll(planned);

    const outcomes = await relayAll(planned, [...signed].reverse());

    expect(near.sponsoredSubmissions.map((s) => s.signedDelegateAction)).toEqual(signed);
    expect(outcomes.map((o) => o.ok && o.sweep.status)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
  });

  test("relays Solana's delegate action first when the wallet was asked for it first, as Meteor numbers nonces in request order", async () => {
    const { near, planAll, from, signAll, relayAll } = await sponsoredProvider(
      "sponsored-all-solana.testnet",
    );
    const planned = await planAll();
    const solana = from(planned, SOLANA_DEVNET);
    const asked = [solana, ...planned.filter((p) => p !== solana)];
    const signed = await signAll(asked);

    await relayAll(planned, [...signed].reverse());

    expect(near.sponsoredSubmissions[0]?.signedDelegateAction).toBe(signed[0]);
  });

  test("matches each delegate action to its Sweep by payload: one asking for a Sweep outside the batch isn't relayed", async () => {
    const { near, planAll, signAll, relayAll, sweepRow } = await sponsoredProvider(
      "sponsored-all-match.testnet",
    );
    const planned = await planAll();
    const [outside, ...batch] = planned;
    const signed = await signAll([outside!, ...batch]);

    const outcomes = await relayAll(batch, signed);

    expect(outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect(near.sponsoredSubmissions.map((s) => s.signedDelegateAction)).toEqual(signed.slice(1));
    expect(await sweepRow(outside!.sweep.id)).toMatchObject({ status: "planned" });
  });
});

describe("one Sweep failing", () => {
  test("a refused delegate action and an expired Sweep leave the others going", async () => {
    const context = await sponsoredProvider("sponsored-all-partial.testnet");
    const { near, planAll, from, signAll, relayAll, sweepRow } = context;
    const planned = await planAll();
    const solana = from(planned, SOLANA_DEVNET);
    const evm = from(planned, BASE_SEPOLIA);
    const nearSweep = from(planned, NEAR_TESTNET);
    const [solanaSigned, nearSigned] = await signAll([solana, nearSweep]);
    // Signed by another account: Herald won't relay it for this Provider.
    const evmSigned = await walletSignedSign({
      accountId: "other.testnet",
      key: context.wallet,
      request: evm.signRequest,
      nonce: 1_000_003n,
    });
    // Past Solana's two-minute signing window, within the others' ten.
    const later = new Date(Date.now() + 5 * 60 * 1000);

    const outcomes = await relayAll(planned, [solanaSigned!, nearSigned!, evmSigned], later);

    const outcome = (sweepId: number) => outcomes.find((o) => o.sweepId === sweepId);
    expect(outcome(evm.sweep.id)).toMatchObject({ ok: false, reason: "delegate_refused" });
    expect(await sweepRow(evm.sweep.id)).toMatchObject({ status: "planned" });
    expect(outcome(solana.sweep.id)).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(outcome(nearSweep.sweep.id)).toMatchObject({
      ok: true,
      sweep: { status: "submitted" },
    });
    expect(near.sponsoredSubmissions.map((s) => s.signedDelegateAction)).toEqual([nearSigned]);
  });

  test("an unanswered relay holds back the delegate actions after it, and presenting the batch again relays them all, still in nonce order", async () => {
    const { near, planAll, signAll, relayAll, sweepRow } = await sponsoredProvider(
      "sponsored-all-unanswered.testnet",
    );
    near.checkNonces = true;
    const planned = await planAll();
    const signed = await signAll(planned);
    near.relayUnreachable = true;

    const first = await relayAll(planned, signed);

    expect(first.map((o) => !o.ok && o.reason)).toEqual([
      "relay_unanswered",
      "held_back",
      "held_back",
    ]);
    for (const { sweep } of planned) {
      expect(await sweepRow(sweep.id)).toMatchObject({ status: "planned" });
    }

    near.relayUnreachable = false;
    const again = await relayAll(planned, signed);

    expect(again.map((o) => o.ok && o.sweep.status)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
    expect(near.sponsoredSubmissions.map((s) => s.signedDelegateAction)).toEqual(signed);
  });
});

describe("the daily cap", () => {
  test("every Sweep in the batch counts against it: those that don't fit aren't relayed, say why, and stay planned", async () => {
    const { near, planAll, signAll, relayAll, sweepRow } = await sponsoredProvider(
      "sponsored-all-cap.testnet",
    );
    // Nine Sweeps still awaiting their signature leave room for one more.
    near.pendingRelayedSigns = true;
    for (let round = 0; round < 3; round++) {
      const planned = await planAll();
      await relayAll(planned, await signAll(planned, 1_000_001n + BigInt(round * 3)));
    }
    const planned = await planAll();

    const outcomes = await relayAll(planned, await signAll(planned, 1_000_010n));

    expect(outcomes.map((o) => (o.ok ? o.sweep.status : o.reason))).toEqual([
      "awaiting_signature",
      "daily_cap_reached",
      "daily_cap_reached",
    ]);
    expect(near.sponsoredSubmissions).toHaveLength(10);
    for (const { sweep } of planned.slice(1)) {
      expect(await sweepRow(sweep.id)).toMatchObject({ status: "planned" });
    }
  });
});

describe("a wallet that stops partway", () => {
  test("discards the Sweeps it signed no delegate action for, and relays the others", async () => {
    const { near, planAll, signAll, relayAll, sweepRow } = await sponsoredProvider(
      "sponsored-all-partway.testnet",
    );
    const planned = await planAll();
    const [unsigned, ...rest] = [...planned].reverse();
    const signed = await signAll(rest);

    const outcomes = await relayAll(planned, signed);

    expect(outcomes.find((o) => o.sweepId === unsigned!.sweep.id)).toMatchObject({
      ok: false,
      reason: "not_signed",
    });
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
    expect(near.sponsoredSubmissions).toHaveLength(2);
    expect(await sweepRow(unsigned!.sweep.id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("discarded"),
    });
  });
});
