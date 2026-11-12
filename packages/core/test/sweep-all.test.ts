import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  completeSweep,
  planSweep,
  planSweepAll,
  refreshSweeps,
  type UsdcBalanceReader,
} from "../src/server/index.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeNearUsdc,
  FakeOneClick,
  FakeSolana,
  fakeReceipts,
  solanaKeyPair,
  SYSTEM_PROGRAM,
  sweepingProvider,
} from "./support/sweeps.ts";

const db = () => createDb(env.DB);

// A NEAR these tests never Sweep from.
const nearUsdc = new FakeNearUsdc();

const BASE_SEPOLIA = "eip155:84532";
const ARBITRUM_SEPOLIA = "eip155:421614";
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const EVM_DESTINATION = "0x000000000000000000000000000000000000d00d";
const BASE = "eip155:8453";
const ARBITRUM = "eip155:42161";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * USDC balances by network. Every EVM chain shares one Receiving Address,
 * so balances keyed by owner alone can't tell Base Sepolia from Arbitrum
 * Sepolia. A network set to `"down"` fails its read.
 */
function balancesByNetwork(balances: Record<string, string>): UsdcBalanceReader {
  return async ({ network }) => {
    const balance = balances[network.caip2] ?? "0";
    if (balance === "down") throw new Error(`${network.label} RPC request failed (TypeError)`);
    return balance;
  };
}

/** A testnet Provider with the given balances, a Solana wallet to Sweep to, and the fakes it Sweeps through. */
async function testnetProvider(accountId: string, balances: Record<string, string>) {
  const context = await sweepingProvider(accountId);
  const solana = new FakeSolana();
  await solana.addTokenAccount(context.provider.solanaAddress, DEVNET_USDC);
  const solanaDestination = solanaKeyPair().address;
  solana.accounts.set(solanaDestination, SYSTEM_PROGRAM);
  const near = new FakeNear();
  const queue = new FakeChainQueue();
  const oneClick = new FakeOneClick();
  const planDeps = {
    db: db(),
    readUsdcBalance: balancesByNetwork(balances),
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: nearUsdc.reader,
    nearQueue: nearUsdc.queue,
    oneClick: oneClick.client,
  };
  const receipts = fakeReceipts();
  const deps = {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: queue.submit,
    readReceipt: receipts.read,
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: nearUsdc.reader,
    nearQueue: nearUsdc.queue,
    oneClick: oneClick.client,
  };
  const base = { providerId: context.provider.id, env: "testnet" as const };
  const target = {
    destinationKind: "same_chain" as const,
    evmDestination: EVM_DESTINATION,
    solanaDestination,
  };
  return {
    ...context,
    solana,
    solanaDestination,
    near,
    queue,
    receipts,
    planDeps,
    deps,
    base,
    target,
  };
}

describe("planSweepAll", () => {
  test("plans one Sweep of the whole balance per chain at or above its minimum", async () => {
    // Arbitrum Sepolia's minimum is 0.001 USDC; Base Sepolia's is 0.15.
    const context = await testnetProvider("all-eligible.testnet", {
      [BASE_SEPOLIA]: "2000000",
      [ARBITRUM_SEPOLIA]: "999",
      [SOLANA_DEVNET]: "3000000",
    });

    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });

    if (!plan.ok) throw new Error(plan.message);
    expect(plan.planned.map(({ sweep }) => sweep)).toEqual([
      expect.objectContaining({
        sourceNetwork: BASE_SEPOLIA,
        amount: "2000000",
        destinationKind: "same_chain",
        destinationAddress: EVM_DESTINATION,
        status: "planned",
      }),
      expect.objectContaining({
        sourceNetwork: SOLANA_DEVNET,
        amount: "3000000",
        destinationKind: "same_chain",
        destinationAddress: context.solanaDestination,
        status: "planned",
      }),
    ]);
    expect(plan.planned.map(({ signRequest }) => signRequest.args.request.path)).toEqual([
      "ethereum-1",
      "solana-1",
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("still plans the other chains when one can't be planned, and says why it was skipped", async () => {
    const context = await testnetProvider("all-partial-plan.testnet", {
      [BASE_SEPOLIA]: "2000000",
      [ARBITRUM_SEPOLIA]: "down",
      [SOLANA_DEVNET]: "3000000",
    });
    // Solana's fee payer can't be reached, so its transaction can't be built.
    context.solana.queueUnreachable = true;

    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });

    if (!plan.ok) throw new Error(plan.message);
    expect(plan.planned.map(({ sweep }) => sweep.sourceNetwork)).toEqual([BASE_SEPOLIA]);
    // In Payment Option order: Solana Devnet comes before Arbitrum Sepolia.
    expect(plan.skipped).toEqual([
      expect.objectContaining({ network: SOLANA_DEVNET, reason: "chain_unavailable" }),
      expect.objectContaining({ network: ARBITRUM_SEPOLIA, reason: "balance_unavailable" }),
    ]);
  });

  test("leaves out a kind of chain the Provider gave no destination for", async () => {
    const context = await testnetProvider("all-evm-only.testnet", {
      [BASE_SEPOLIA]: "2000000",
      [ARBITRUM_SEPOLIA]: "1000",
      [SOLANA_DEVNET]: "3000000",
    });

    const plan = await planSweepAll(context.planDeps, {
      ...context.base,
      target: { destinationKind: "same_chain", evmDestination: EVM_DESTINATION },
    });

    if (!plan.ok) throw new Error(plan.message);
    expect(plan.planned.map(({ sweep }) => [sweep.sourceNetwork, sweep.amount])).toEqual([
      [BASE_SEPOLIA, "2000000"],
      [ARBITRUM_SEPOLIA, "1000"],
    ]);
    expect(plan.skipped).toEqual([]);
  });

  test("refuses when no chain holds its minimum", async () => {
    const context = await testnetProvider("all-nothing.testnet", {
      [BASE_SEPOLIA]: "149999",
      [ARBITRUM_SEPOLIA]: "0",
    });

    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });

    expect(plan).toMatchObject({ ok: false, reason: "nothing_to_sweep" });
  });

  test("plans only as many Sweeps as the daily cap leaves room for", async () => {
    const context = await testnetProvider("all-cap.testnet", {
      [BASE_SEPOLIA]: "20000000",
      [ARBITRUM_SEPOLIA]: "1000",
      [SOLANA_DEVNET]: "3000000",
    });
    // 9 of the 10 Sweeps allowed in 24 hours are already submitted.
    for (let i = 0; i < 9; i++) {
      const one = await planSweep(context.planDeps, {
        ...context.base,
        network: BASE_SEPOLIA,
        amount: "150000",
        destination: EVM_DESTINATION,
      });
      if (!one.ok) throw new Error(one.message);
      const nearTxHash = await context.near.sign({
        signerId: context.provider.accountId,
        request: one.signRequest,
        key: context.receivingKey,
      });
      await completeSweep(context.deps, { ...context.base, sweepId: one.sweep.id, nearTxHash });
    }

    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });

    if (!plan.ok) throw new Error(plan.message);
    expect(plan.planned.map(({ sweep }) => sweep.sourceNetwork)).toEqual([BASE_SEPOLIA]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ network: SOLANA_DEVNET, reason: "daily_cap_reached" }),
      expect.objectContaining({ network: ARBITRUM_SEPOLIA, reason: "daily_cap_reached" }),
    ]);
  });

  test("gives a chain whose balance can't be read no place under the daily cap", async () => {
    const context = await testnetProvider("all-cap-unread.testnet", {
      [BASE_SEPOLIA]: "down",
      [ARBITRUM_SEPOLIA]: "1000",
      [SOLANA_DEVNET]: "3000000",
    });
    for (let i = 0; i < 9; i++) {
      const sweep = await planSweep(
        { ...context.planDeps, readUsdcBalance: balancesByNetwork({ [ARBITRUM_SEPOLIA]: "9000" }) },
        {
          ...context.base,
          network: ARBITRUM_SEPOLIA,
          amount: "1000",
          destination: EVM_DESTINATION,
        },
      );
      if (!sweep.ok) throw new Error(sweep.message);
      const nearTxHash = await context.near.sign({
        signerId: context.provider.accountId,
        request: sweep.signRequest,
        key: context.receivingKey,
      });
      await completeSweep(context.deps, { ...context.base, sweepId: sweep.sweep.id, nearTxHash });
    }

    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });

    if (!plan.ok) throw new Error(plan.message);
    expect(plan.planned.map(({ sweep }) => sweep.sourceNetwork)).toEqual([SOLANA_DEVNET]);
    expect(plan.skipped.map(({ network, reason }) => [network, reason])).toEqual([
      [BASE_SEPOLIA, "balance_unavailable"],
      [ARBITRUM_SEPOLIA, "daily_cap_reached"],
    ]);
  });

  test("Sweeps each chain to the destination chain: on that chain itself, through 1Click from the others", async () => {
    const context = await sweepingProvider("all-cross-chain.near");
    const oneClick = new FakeOneClick();
    const solana = new FakeSolana();
    await solana.addTokenAccount(
      context.provider.solanaAddress,
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    const planDeps = {
      db: db(),
      readUsdcBalance: balancesByNetwork({
        [BASE]: "5000000",
        [ARBITRUM]: "4000000",
        [SOLANA]: "3000000",
      }),
      readSolana: solana.reader,
      solanaQueue: solana.queue,
      readNear: nearUsdc.reader,
      nearQueue: nearUsdc.queue,
      oneClick: oneClick.client,
    };

    const plan = await planSweepAll(planDeps, {
      providerId: context.provider.id,
      env: "mainnet",
      target: {
        destinationKind: "cross_chain",
        destinationNetwork: BASE,
        destination: EVM_DESTINATION,
      },
    });

    if (!plan.ok) throw new Error(plan.message);
    expect(
      plan.planned.map(({ sweep, quote }) => [
        sweep.sourceNetwork,
        sweep.destinationKind,
        sweep.destinationNetwork,
        sweep.destinationAddress,
        quote !== null,
      ]),
    ).toEqual([
      [BASE, "same_chain", BASE, EVM_DESTINATION, false],
      [SOLANA, "cross_chain", BASE, EVM_DESTINATION, true],
      [ARBITRUM, "cross_chain", BASE, EVM_DESTINATION, true],
    ]);
    expect(oneClick.quotes.map((quote) => quote.amount)).toEqual(
      expect.arrayContaining(["3000000", "4000000"]),
    );
  });
});

describe("completing the Sweeps of a Sweep all", () => {
  test("each Sweep completes from its own NEAR transaction, so one that fails leaves the others going", async () => {
    const context = await testnetProvider("all-partial-complete.testnet", {
      [BASE_SEPOLIA]: "2000000",
      [ARBITRUM_SEPOLIA]: "1000",
      [SOLANA_DEVNET]: "3000000",
    });
    const plan = await planSweepAll(context.planDeps, { ...context.base, target: context.target });
    if (!plan.ok) throw new Error(plan.message);

    // The wallet sent one NEAR transaction per Sweep, in one request; the
    // Solana one failed on NEAR.
    const signed = await Promise.all(
      plan.planned.map(async ({ sweep, signRequest }) => ({
        sweepId: sweep.id,
        nearTxHash: await context.near.sign({
          signerId: context.provider.accountId,
          request: signRequest,
          key: sweep.sourceKind === "evm" ? context.receivingKey : context.solanaKey,
          failure:
            sweep.sourceKind === "solana"
              ? { ActionError: { kind: { FunctionCallError: { ExecutionError: "timed out" } } } }
              : undefined,
        }),
      })),
    );
    const completed = await Promise.all(
      signed.map((one) => completeSweep(context.deps, { ...context.base, ...one })),
    );

    expect(
      completed.map((result) =>
        result.ok ? [result.sweep.sourceNetwork, result.sweep.status] : result.message,
      ),
    ).toEqual([
      [BASE_SEPOLIA, "submitted"],
      [SOLANA_DEVNET, "failed"],
      [ARBITRUM_SEPOLIA, "submitted"],
    ]);
    expect(context.queue.submissions.map((submission) => submission.network)).toEqual(
      expect.arrayContaining([BASE_SEPOLIA, ARBITRUM_SEPOLIA]),
    );
    expect(context.solana.submissions).toHaveLength(0);
    const listed = await refreshSweeps(context.deps, context.base);
    expect(Object.fromEntries(listed.map((sweep) => [sweep.sourceNetwork, sweep.status]))).toEqual({
      [BASE_SEPOLIA]: "submitted",
      [ARBITRUM_SEPOLIA]: "submitted",
      [SOLANA_DEVNET]: "failed",
    });

    // Both EVM transfers land; the failed Solana Sweep stays failed.
    for (const sweep of listed) {
      if (sweep.sourceTxHash) context.receipts.receipts[sweep.sourceTxHash] = "success";
    }
    const settled = await refreshSweeps(context.deps, context.base);
    expect(Object.fromEntries(settled.map((sweep) => [sweep.sourceNetwork, sweep.status]))).toEqual(
      {
        [BASE_SEPOLIA]: "confirmed",
        [ARBITRUM_SEPOLIA]: "confirmed",
        [SOLANA_DEVNET]: "failed",
      },
    );
  });
});
