import { createDb } from "@herald/db";
import { eip3009ABI } from "@x402/evm";
import { env } from "cloudflare:workers";
import {
  decodeFunctionData,
  hashTypedData,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey } from "viem/accounts";
import { describe, expect, test } from "vite-plus/test";
import type { Provider } from "../src/index.ts";
import {
  completeSweep,
  getSweepOptions,
  planSweep,
  refreshSweeps,
  type UsdcBalanceReader,
} from "../src/server/index.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeSolana,
  fakeReceipts,
  sweepingProvider,
  usdcBalances,
} from "./support/sweeps.ts";

const db = () => createDb(env.DB);

const BASE_SEPOLIA = "eip155:84532";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DESTINATION = "0x000000000000000000000000000000000000d00d";

const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

describe("planSweep", () => {
  test("plans an EIP-3009 transfer from the Receiving Address to the destination, for the MPC signer to sign", async () => {
    const { provider } = await sweepingProvider("plan-payload.testnet");
    const now = new Date("2026-11-11T12:00:00Z");

    const plan = await planSweep(planDeps(usdcBalances({ [provider.evmAddress]: "5000000" })), {
      providerId: provider.id,
      env: "testnet",
      network: BASE_SEPOLIA,
      amount: "1500000",
      destination: DESTINATION,
      now,
    });

    if (!plan.ok) throw new Error(plan.message);
    const { sweep, signRequest } = plan;
    if (sweep.sourceKind !== "evm") throw new Error("Expected an EVM Sweep");
    expect(sweep).toMatchObject({
      providerId: provider.id,
      sourceKind: "evm",
      sourceNetwork: BASE_SEPOLIA,
      asset: BASE_SEPOLIA_USDC,
      amount: "1500000",
      destinationKind: "same_chain",
      destinationNetwork: BASE_SEPOLIA,
      destinationAddress: DESTINATION,
      status: "planned",
    });
    // A short window around the time it was planned.
    const nowSeconds = now.getTime() / 1000;
    expect(sweep.validAfter).toBeLessThanOrEqual(nowSeconds);
    expect(sweep.validBefore).toBeGreaterThan(nowSeconds);
    expect(sweep.validBefore - nowSeconds).toBeLessThanOrEqual(15 * 60);
    // The EIP-712 hash Base Sepolia's USDC ("USDC", version 2) checks.
    const payload = hashTypedData({
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: BASE_SEPOLIA_USDC,
      },
      types: transferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: provider.evmAddress as Address,
        to: DESTINATION,
        value: 1_500_000n,
        validAfter: BigInt(sweep.validAfter),
        validBefore: BigInt(sweep.validBefore),
        nonce: sweep.authorizationNonce as Hex,
      },
    });
    expect(sweep.payloadHash).toBe(payload);
    expect(signRequest).toEqual({
      contractId: "v1.signer-prod.testnet",
      methodName: "sign",
      args: {
        request: { payload_v2: { Ecdsa: payload.slice(2) }, path: "ethereum-1", domain_id: 0 },
      },
      deposit: "1",
      gas: expect.any(String),
    });
    expect(BigInt(signRequest.gas)).toBeGreaterThanOrEqual(15_000_000_000_000n);
  });

  test("refuses an amount below the network's minimum and accepts the minimum itself", async () => {
    const { provider } = await sweepingProvider("plan-minimum.testnet");
    const deps = planDeps(usdcBalances({ [provider.evmAddress]: "5000000" }));
    const plan = (amount: string) =>
      planSweep(deps, {
        providerId: provider.id,
        env: "testnet",
        network: BASE_SEPOLIA,
        amount,
        destination: DESTINATION,
      });

    // Base Sepolia's seeded minimum is 0.15 USDC.
    const below = await plan("149999");
    const atMinimum = await plan("150000");

    expect(below).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(!below.ok && below.message).toContain("0.15");
    expect(atMinimum.ok).toBe(true);
  });

  test("refuses more than the Receiving Address holds on that chain", async () => {
    const { provider } = await sweepingProvider("plan-balance.testnet");

    const plan = await planSweep(planDeps(usdcBalances({ [provider.evmAddress]: "1000000" })), {
      providerId: provider.id,
      env: "testnet",
      network: BASE_SEPOLIA,
      amount: "1000001",
      destination: DESTINATION,
    });

    expect(plan).toMatchObject({ ok: false, reason: "insufficient_balance" });
    expect(!plan.ok && plan.message).toContain("1 USDC");
  });

  test("refuses to plan when the balance can't be read", async () => {
    const { provider } = await sweepingProvider("plan-balance-down.testnet");

    const plan = await planSweep(
      planDeps(async () => {
        throw new Error("Base Sepolia RPC request failed (TypeError)");
      }),
      {
        providerId: provider.id,
        env: "testnet",
        network: BASE_SEPOLIA,
        amount: "150000",
        destination: DESTINATION,
      },
    );

    expect(plan).toMatchObject({ ok: false, reason: "balance_unavailable" });
  });

  test.each([
    {
      id: "own",
      case: "the Receiving Address itself",
      destination: "own",
      reason: "invalid_destination",
    },
    {
      id: "zero",
      case: "the zero address",
      destination: "0x0000000000000000000000000000000000000000",
      reason: "invalid_destination",
    },
    {
      id: "usdc",
      case: "the USDC contract",
      destination: BASE_SEPOLIA_USDC,
      reason: "invalid_destination",
    },
    { id: "malformed", case: "malformed", destination: "0x1234", reason: "invalid_request" },
  ])("refuses a destination that is $case", async ({ id, destination, reason }) => {
    const { provider } = await sweepingProvider(`plan-destination-${id}.testnet`);

    const plan = await planSweep(planDeps(usdcBalances({ [provider.evmAddress]: "5000000" })), {
      providerId: provider.id,
      env: "testnet",
      network: BASE_SEPOLIA,
      amount: "150000",
      destination: destination === "own" ? provider.evmAddress : destination,
    });

    expect(plan).toMatchObject({ ok: false, reason });
  });

  test.each([
    { case: "a mainnet network on testnet", network: "eip155:8453" },
    { case: "a network Herald doesn't list", network: "eip155:10" },
  ])("refuses to plan a Sweep on $case", async ({ network }) => {
    const { provider } = await sweepingProvider(
      `plan-network-${network.split(":")[1]!.slice(0, 8).toLowerCase()}.testnet`,
    );

    const plan = await planSweep(planDeps(usdcBalances({ [provider.evmAddress]: "5000000" })), {
      providerId: provider.id,
      env: "testnet",
      network,
      amount: "150000",
      destination: DESTINATION,
    });

    expect(plan).toMatchObject({ ok: false, reason: "unsupported_network" });
  });
});

/** A testnet Provider with USDC on Base Sepolia, and a Sweep it planned. */
async function plannedSweep(accountId: string, amount = "1500000") {
  return plannedSweepFor(await sweepingProvider(accountId), amount);
}

async function plannedSweepFor(
  { provider, receivingKey }: { provider: Provider; receivingKey: Hex },
  amount = "1500000",
) {
  const plan = await planSweep(planDeps(usdcBalances({ [provider.evmAddress]: "5000000" })), {
    providerId: provider.id,
    env: "testnet",
    network: BASE_SEPOLIA,
    amount,
    destination: DESTINATION,
  });
  if (!plan.ok) throw new Error(plan.message);
  const { sweep, signRequest } = plan;
  if (sweep.sourceKind !== "evm") throw new Error("Expected an EVM Sweep");
  return { provider, receivingKey, sweep, signRequest };
}

describe("getSweepOptions", () => {
  test("lists each chain with the Receiving Address there, its balance and the minimum Sweep", async () => {
    const { provider } = await sweepingProvider("options.testnet");

    const options = await getSweepOptions(
      {
        db: db(),
        readUsdcBalance: usdcBalances({
          [provider.evmAddress]: "2500000",
          [provider.solanaAddress]: "700000",
        }),
      },
      { providerId: provider.id, env: "testnet" },
    );

    expect(options).toEqual({
      chains: [
        {
          network: BASE_SEPOLIA,
          kind: "evm",
          label: "Base Sepolia",
          address: provider.evmAddress,
          balance: { ok: true, amount: "2500000" },
          minimum: "150000",
        },
        {
          network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          kind: "solana",
          label: "Solana Devnet",
          address: provider.solanaAddress,
          balance: { ok: true, amount: "700000" },
          minimum: "1000",
        },
        {
          network: "eip155:421614",
          kind: "evm",
          label: "Arbitrum Sepolia",
          address: provider.evmAddress,
          balance: { ok: true, amount: "2500000" },
          minimum: "1000",
        },
      ],
      submittedToday: 0,
      dailyCap: 10,
    });
  });
});

describe("completeSweep", () => {
  test("refuses a NEAR transaction another Sweep already uses", async () => {
    const first = await plannedSweep("complete-reused-a.testnet");
    const second = await plannedSweepFor({
      provider: first.provider,
      receivingKey: first.receivingKey,
    });
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const nearTxHash = await near.sign({
      signerId: first.provider.accountId,
      request: first.signRequest,
      key: first.receivingKey,
    });
    const input = { providerId: first.provider.id, env: "testnet" as const, nearTxHash };
    await completeSweep(sweepDeps(near, queue), { ...input, sweepId: first.sweep.id });

    const reused = await completeSweep(sweepDeps(near, queue), {
      ...input,
      sweepId: second.sweep.id,
    });

    expect(reused).toMatchObject({ ok: false, reason: "near_tx_mismatch" });
    expect(queue.submissions).toHaveLength(1);
  });

  test("reads the signature from the NEAR transaction and submits the signed transfer through the chain queue", async () => {
    const { provider, receivingKey, sweep, signRequest } =
      await plannedSweep("complete-ok.testnet");
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
    });

    const result = await completeSweep(sweepDeps(near, queue), {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep).toMatchObject({
      status: "submitted",
      nearTxHash,
      sourceTxHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      error: null,
    });
    expect(queue.submissions).toHaveLength(1);
    const [submission] = queue.submissions;
    expect(submission).toMatchObject({ network: BASE_SEPOLIA, asset: BASE_SEPOLIA_USDC });
    // The call USDC executes: the planned transfer, with a signature whose
    // ecrecover is the Receiving Address.
    const call = decodeFunctionData({ abi: eip3009ABI, data: submission!.data });
    expect(call.functionName).toBe("transferWithAuthorization");
    const [from, to, value, validAfter, validBefore, nonce, v, r, s] = call.args as unknown as [
      Address,
      Address,
      bigint,
      bigint,
      bigint,
      Hex,
      number,
      Hex,
      Hex,
    ];
    expect({ from: from.toLowerCase(), to: to.toLowerCase(), value }).toEqual({
      from: provider.evmAddress,
      to: DESTINATION,
      value: 1_500_000n,
    });
    const signer = await recoverTypedDataAddress({
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: BASE_SEPOLIA_USDC,
      },
      types: transferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: { from, to, value, validAfter, validBefore, nonce },
      signature: { r, s, v: BigInt(v) },
    });
    expect(signer.toLowerCase()).toBe(provider.evmAddress);
  });

  test("rejects a signature by another key, and submits nothing", async () => {
    const { provider, sweep, signRequest } = await plannedSweep("complete-wrong-key.testnet");
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    // As if the MPC network had signed for another account or path.
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: generatePrivateKey(),
    });

    const result = await completeSweep(sweepDeps(near, queue), {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed", sourceTxHash: null } });
    expect(result.ok && result.sweep.error).toContain("isn't your Receiving Address's signature");
    expect(queue.submissions).toEqual([]);
  });

  test("rejects a NEAR transaction that signed another payload, such as a transfer to someone else", async () => {
    const { provider, receivingKey, sweep, signRequest } = await plannedSweep(
      "complete-substituted.testnet",
    );
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    // The Provider's own signature, but of a different transfer: what a
    // tampered dashboard would pass off as this Sweep's.
    const other = await plannedSweep("complete-substituted-other.testnet");
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
      payload: other.sweep.payloadHash as Hex,
    });

    const result = await completeSweep(sweepDeps(near, queue), {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(queue.submissions).toEqual([]);
  });

  test("fails the Sweep when the NEAR signing transaction failed", async () => {
    const { provider, receivingKey, sweep, signRequest } = await plannedSweep(
      "complete-near-failed.testnet",
    );
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
      failure: {
        ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked" } } },
      },
    });

    const result = await completeSweep(sweepDeps(near, queue), {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(result.ok && result.sweep.error).toContain("NEAR");
    expect(queue.submissions).toEqual([]);
  });
});

describe("the daily cap", () => {
  const HOUR_MS = 60 * 60 * 1000;

  /** Plans, signs and completes a Sweep, as the dashboard does. */
  async function sweepOnce(
    context: Awaited<ReturnType<typeof sweepingProvider>>,
    deps: ReturnType<typeof sweepDeps>,
    near: FakeNear,
  ) {
    const plan = await planSweep(
      planDeps(usdcBalances({ [context.provider.evmAddress]: "5000000" })),
      {
        providerId: context.provider.id,
        env: "testnet",
        network: BASE_SEPOLIA,
        amount: "150000",
        destination: DESTINATION,
      },
    );
    if (!plan.ok) return plan;
    const nearTxHash = await near.sign({
      signerId: context.provider.accountId,
      request: plan.signRequest,
      key: context.receivingKey,
    });
    return completeSweep(deps, {
      providerId: context.provider.id,
      env: "testnet",
      sweepId: plan.sweep.id,
      nearTxHash,
    });
  }

  test("allows 10 Sweeps a day, then refuses to plan more until a day has passed", async () => {
    const context = await sweepingProvider("cap-plan.testnet");
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const deps = sweepDeps(near, queue);
    for (let i = 0; i < 10; i++) {
      expect(await sweepOnce(context, deps, near)).toMatchObject({
        ok: true,
        sweep: { status: "submitted" },
      });
    }
    const planAt = (now: Date) =>
      planSweep(planDeps(usdcBalances({ [context.provider.evmAddress]: "5000000" })), {
        providerId: context.provider.id,
        env: "testnet",
        network: BASE_SEPOLIA,
        amount: "150000",
        destination: DESTINATION,
        now,
      });

    const eleventh = await planAt(new Date());
    const nextDay = await planAt(new Date(Date.now() + 25 * HOUR_MS));

    expect(eleventh).toMatchObject({ ok: false, reason: "daily_cap_reached" });
    expect(nextDay.ok).toBe(true);
    expect(queue.submissions).toHaveLength(10);
  });

  test("doesn't submit a signed Sweep that would go over the cap", async () => {
    const context = await sweepingProvider("cap-complete.testnet");
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const deps = sweepDeps(near, queue);
    // Planned while under the cap, signed once 10 others went out.
    const late = await plannedSweepFor(context);
    for (let i = 0; i < 10; i++) await sweepOnce(context, deps, near);
    const nearTxHash = await near.sign({
      signerId: context.provider.accountId,
      request: late.signRequest,
      key: context.receivingKey,
    });

    const result = await completeSweep(deps, {
      providerId: context.provider.id,
      env: "testnet",
      sweepId: late.sweep.id,
      nearTxHash,
    });

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(result.ok && result.sweep.error).toContain("10 Sweeps");
    expect(queue.submissions).toHaveLength(10);
  });
});

describe("submitting a Sweep", () => {
  test("a transfer the chain queue refuses fails the Sweep", async () => {
    const { provider, receivingKey, sweep, signRequest } =
      await plannedSweep("submit-refused.testnet");
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    queue.refuseWith = "Broadcast failed: insufficient funds for gas";
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
    });

    const result = await completeSweep(sweepDeps(near, queue), {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });

    expect(result).toMatchObject({
      ok: true,
      sweep: { status: "failed", sourceTxHash: null, submittedAt: null },
    });
    expect(result.ok && result.sweep.error).toContain("insufficient funds for gas");
  });

  test("an unreachable chain queue leaves the Sweep awaiting its signature, and a refresh submits it", async () => {
    const { provider, receivingKey, sweep, signRequest } = await plannedSweep(
      "submit-unreachable.testnet",
    );
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    queue.unreachable = true;
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
    });
    const deps = sweepDeps(near, queue);

    const first = await completeSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });
    queue.unreachable = false;
    const [refreshed] = await refreshSweeps(deps, { providerId: provider.id, env: "testnet" });

    expect(first).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(refreshed).toMatchObject({ id: sweep.id, status: "submitted" });
    expect(queue.submissions).toHaveLength(1);
  });
});

describe("refreshSweeps", () => {
  test("follows a Sweep from a signature the MPC network is still producing to a confirmed transfer", async () => {
    const { provider, receivingKey, sweep, signRequest } = await plannedSweep(
      "refresh-confirmed.testnet",
    );
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const receipts = fakeReceipts();
    const deps = sweepDeps(near, queue, receipts);
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
      pending: true,
    });
    const statusNow = async () =>
      (await refreshSweeps(deps, { providerId: provider.id, env: "testnet" }))[0];

    const completed = await completeSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });
    const stillSigning = await statusNow();
    await near.finish(nearTxHash, sweep.payloadHash as Hex, receivingKey);
    const submitted = await statusNow();
    const notMinedYet = await statusNow();
    receipts.receipts[submitted!.sourceTxHash!] = "success";
    const confirmed = await statusNow();

    expect(completed).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(stillSigning).toMatchObject({ status: "awaiting_signature" });
    expect(submitted).toMatchObject({ status: "submitted" });
    expect(notMinedYet).toMatchObject({ status: "submitted" });
    expect(confirmed).toMatchObject({
      id: sweep.id,
      status: "confirmed",
      nearTxHash,
      sourceTxHash: submitted!.sourceTxHash,
    });
  });

  test("a transfer that reverted on-chain fails the Sweep", async () => {
    const { provider, receivingKey, sweep, signRequest } = await plannedSweep(
      "refresh-reverted.testnet",
    );
    const near = new FakeNear();
    const queue = new FakeChainQueue();
    const receipts = fakeReceipts();
    const deps = sweepDeps(near, queue, receipts);
    const nearTxHash = await near.sign({
      signerId: provider.accountId,
      request: signRequest,
      key: receivingKey,
    });
    const completed = await completeSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      sweepId: sweep.id,
      nearTxHash,
    });
    if (!completed.ok) throw new Error(completed.message);
    receipts.receipts[completed.sweep.sourceTxHash!] = "reverted";

    const [refreshed] = await refreshSweeps(deps, { providerId: provider.id, env: "testnet" });

    expect(refreshed).toMatchObject({ status: "failed" });
    expect(refreshed?.error).toContain("reverted");
  });
});

/** Planning's deps: D1, the given balances, and a Solana that EVM Sweeps never touch. */
function planDeps(readUsdcBalance: UsdcBalanceReader) {
  const solana = new FakeSolana();
  return { db: db(), readUsdcBalance, readSolana: solana.reader, solanaQueue: solana.queue };
}

function sweepDeps(near: FakeNear, queue: FakeChainQueue, receipts = fakeReceipts()) {
  const solana = new FakeSolana();
  return {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: queue.submit,
    readReceipt: receipts.read,
    readSolana: solana.reader,
    solanaQueue: solana.queue,
  };
}
