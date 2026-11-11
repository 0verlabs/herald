import { createDb } from "@herald/db";
import {
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
  identifyTokenInstruction,
} from "@solana-program/token";
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getTransactionDecoder,
} from "@solana/kit";
import { eip3009ABI } from "@x402/evm";
import { env } from "cloudflare:workers";
import { decodeFunctionData, hashTypedData, type Address, type Hex } from "viem";
import { describe, expect, test } from "vite-plus/test";
import type { SolanaSweep } from "../src/index.ts";
import {
  completeSweep,
  discardSweep,
  getSweepOptions,
  ONE_CLICK_DEADLINE_SECONDS,
  ONE_CLICK_DEPOSIT_MARGIN_SECONDS,
  ONE_CLICK_PICKUP_GRACE_SECONDS,
  planSweep,
  refreshSweeps,
  SWEEP_VALIDITY_SECONDS,
} from "../src/server/index.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeOneClick,
  FakeSolana,
  fakeReceipts,
  solanaKeyPair,
  sweepingProvider,
  tokenAccountOf,
  usdcBalances,
} from "./support/sweeps.ts";

// 1Click runs on mainnet only, so these Sweeps are mainnet ones. Every
// outside party is a fake: NEAR and the MPC signer, the chains, Herald's
// chain queues and 1Click.

const db = () => createDb(env.DB);

const BASE = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ARBITRUM = "eip155:42161";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_USDC_1CS = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const ARBITRUM_USDC_1CS = "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near";
const SOLANA_USDC_1CS = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
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

/**
 * A mainnet Provider holding 5 USDC on every chain, and the fakes it
 * Sweeps through.
 */
async function mainnetProvider(accountId: string) {
  const context = await sweepingProvider(accountId);
  const oneClick = new FakeOneClick();
  const solana = new FakeSolana();
  const near = new FakeNear();
  const queue = new FakeChainQueue();
  const receipts = fakeReceipts();
  const planDeps = {
    db: db(),
    readUsdcBalance: usdcBalances({
      [context.provider.evmAddress]: "5000000",
      [context.provider.solanaAddress]: "5000000",
    }),
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    oneClick: oneClick.client,
  };
  const deps = {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: queue.submit,
    readReceipt: receipts.read,
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    oneClick: oneClick.client,
  };
  const base = { providerId: context.provider.id, env: "mainnet" as const };
  const refresh = async () => (await refreshSweeps(deps, base))[0];
  return { ...context, oneClick, solana, near, queue, receipts, planDeps, deps, base, refresh };
}

type Context = Awaited<ReturnType<typeof mainnetProvider>>;

/** Plans a 1.5 USDC Sweep from Base to an address on Arbitrum. */
async function planBaseToArbitrum(context: Context, now?: Date) {
  const plan = await planSweep(context.planDeps, {
    ...context.base,
    network: BASE,
    amount: "1500000",
    destinationKind: "cross_chain",
    destinationNetwork: ARBITRUM,
    destination: DESTINATION,
    now,
  });
  if (!plan.ok) throw new Error(plan.message);
  if (plan.sweep.sourceKind !== "evm" || !plan.quote)
    throw new Error("Expected a quoted EVM Sweep");
  return { sweep: plan.sweep, signRequest: plan.signRequest, quote: plan.quote };
}

/** Plans, signs and completes a cross-chain Sweep from Base; it ends `submitted`. */
async function submittedSweep(context: Context) {
  const planned = await planBaseToArbitrum(context);
  const nearTxHash = await context.near.sign({
    signerId: context.provider.accountId,
    request: planned.signRequest,
    key: context.receivingKey,
  });
  const completed = await completeSweep(context.deps, {
    ...context.base,
    sweepId: planned.sweep.id,
    nearTxHash,
  });
  if (!completed.ok) throw new Error(completed.message);
  expect(completed.sweep.status).toBe("submitted");
  return { ...planned, sweep: completed.sweep, depositAddress: planned.quote.depositAddress };
}

/** A submitted cross-chain Sweep whose transfer landed on Base. */
async function confirmedSweep(context: Context) {
  const submitted = await submittedSweep(context);
  context.receipts.receipts[submitted.sweep.sourceTxHash!] = "success";
  expect(await context.refresh()).toMatchObject({ status: "confirmed" });
  return submitted;
}

describe("planning a cross-chain Sweep", () => {
  test("asks 1Click for a live quote refunding to the source Receiving Address, and pays the transfer to its deposit address", async () => {
    const context = await mainnetProvider("oc-plan.near");
    const now = new Date("2026-11-11T12:00:00Z");

    const { sweep, signRequest, quote } = await planBaseToArbitrum(context, now);

    expect(context.oneClick.quotes).toEqual([
      {
        originAsset: BASE_USDC_1CS,
        destinationAsset: ARBITRUM_USDC_1CS,
        amount: "1500000",
        refundTo: context.provider.evmAddress,
        recipient: DESTINATION,
        recipientType: "DESTINATION_CHAIN",
        slippageTolerance: expect.any(Number),
        deadline: new Date(now.getTime() + ONE_CLICK_DEADLINE_SECONDS * 1000),
      },
    ]);
    // What the page shows before signing: 1Click keeps 0.001 USDC.
    expect(quote).toEqual({
      depositAddress: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      amountIn: "1500000",
      amountOut: "1499000",
      minAmountOut: expect.any(String),
      fee: "1000",
      refundFee: "2400",
      minimum: "150000",
      timeEstimateSeconds: 34,
      signBy: new Date(sweep.validBefore * 1000),
    });
    expect(BigInt(quote.minAmountOut)).toBeLessThanOrEqual(1_499_000n);
    expect(sweep).toMatchObject({
      sourceNetwork: BASE,
      amount: "1500000",
      destinationKind: "cross_chain",
      destinationNetwork: ARBITRUM,
      destinationAddress: DESTINATION,
      destinationAsset: ARBITRUM_USDC_1CS,
      oneClickDepositAddress: quote.depositAddress,
      oneClickQuoteId: expect.any(String),
      oneClickSignature: expect.stringMatching(/^ed25519:/),
      quoteAmountOut: "1499000",
      quoteMinAmountOut: quote.minAmountOut,
      quoteRefundFee: "2400",
      quoteTimeEstimate: 34,
      quoteDeadline: new Date(now.getTime() + ONE_CLICK_DEADLINE_SECONDS * 1000),
      status: "planned",
    });
    // The MPC signer signs an EIP-3009 transfer to the deposit address, not
    // to the final destination.
    const payload = hashTypedData({
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: BASE_USDC },
      types: transferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: context.provider.evmAddress as Address,
        to: quote.depositAddress as Address,
        value: 1_500_000n,
        validAfter: BigInt(sweep.validAfter),
        validBefore: BigInt(sweep.validBefore),
        nonce: sweep.authorizationNonce as Hex,
      },
    });
    expect(sweep.payloadHash).toBe(payload);
    expect(signRequest).toMatchObject({
      contractId: "v1.signer",
      args: { request: { payload_v2: { Ecdsa: payload.slice(2) }, path: "ethereum-1" } },
    });
  });

  test("into NEAR Intents, credits the Provider Account with the source chain's USDC token", async () => {
    const context = await mainnetProvider("oc-intents.near");

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "1500000",
      destinationKind: "intents",
    });

    if (!plan.ok) throw new Error(plan.message);
    expect(context.oneClick.quotes).toMatchObject([
      {
        originAsset: BASE_USDC_1CS,
        destinationAsset: BASE_USDC_1CS,
        refundTo: context.provider.evmAddress,
        recipient: "oc-intents.near",
        recipientType: "INTENTS",
      },
    ]);
    expect(plan.sweep).toMatchObject({
      destinationKind: "intents",
      destinationNetwork: "near:mainnet",
      destinationAddress: "oc-intents.near",
      destinationAsset: BASE_USDC_1CS,
      oneClickDepositAddress: plan.quote?.depositAddress,
    });
  });

  test("from Solana, the SPL transfer pays the deposit address's USDC account, and refunds go to the Solana Receiving Address", async () => {
    const context = await mainnetProvider("oc-solana.near");

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: SOLANA,
      amount: "1500000",
      destinationKind: "intents",
    });

    if (!plan.ok) throw new Error(plan.message);
    const sweep = plan.sweep as SolanaSweep;
    const depositAddress = plan.quote!.depositAddress;
    expect(context.oneClick.quotes).toMatchObject([
      {
        originAsset: SOLANA_USDC_1CS,
        destinationAsset: SOLANA_USDC_1CS,
        refundTo: context.provider.solanaAddress,
        recipientType: "INTENTS",
      },
    ]);
    const transaction = getTransactionDecoder().decode(
      getBase64Encoder().encode(sweep.solanaTransaction),
    );
    const instructions = getInstructionsFromCompiledTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
    );
    const transfer = instructions.find(
      (i) =>
        i.programAddress === TOKEN_PROGRAM_ADDRESS &&
        identifyTokenInstruction(i.data!) === TokenInstruction.TransferChecked,
    );
    expect(parseTransferCheckedInstruction(transfer as never).accounts.destination.address).toBe(
      await tokenAccountOf(depositAddress, SOLANA_USDC),
    );
  });

  test("lets the quote's deadline shorten the signing window, so the transfer lands well before 1Click's deposit address goes inactive", async () => {
    const context = await mainnetProvider("oc-short-deadline.near");
    const now = new Date("2026-11-11T12:00:00Z");
    // 1Click answers a deadline only 15 minutes away.
    context.oneClick.tamper = (quote) => {
      quote.deadline = new Date(now.getTime() + 15 * 60 * 1000);
    };

    const { sweep, quote } = await planBaseToArbitrum(context, now);

    const nowSeconds = now.getTime() / 1000;
    expect(sweep.validBefore).toBe(nowSeconds + 15 * 60 - ONE_CLICK_DEPOSIT_MARGIN_SECONDS);
    expect(sweep.validBefore).toBeLessThan(nowSeconds + SWEEP_VALIDITY_SECONDS);
    expect(quote.signBy).toEqual(new Date(sweep.validBefore * 1000));
  });

  test("refuses a quote that leaves no time to sign, so the Provider asks for a fresh one", async () => {
    const context = await mainnetProvider("oc-no-time.near");
    const now = new Date("2026-11-11T12:00:00Z");
    context.oneClick.tamper = (quote) => {
      quote.deadline = new Date(now.getTime() + ONE_CLICK_DEPOSIT_MARGIN_SECONDS * 1000 + 5_000);
    };

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "1500000",
      destinationKind: "intents",
      now,
    });

    expect(plan).toMatchObject({ ok: false, reason: "quote_unavailable" });
  });

  test("passes on 1Click's minimum for the route", async () => {
    const context = await mainnetProvider("oc-minimum.near");
    context.oneClick.refusal = {
      ok: false,
      reason: "below_minimum",
      minimum: "230000",
      message: "Amount is too low for bridge, try at least 230000",
    };

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "150000",
      destinationKind: "intents",
    });

    expect(plan).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(!plan.ok && plan.message).toContain("0.23 USDC");
  });

  test("refuses a route whose refund fee would take more than 10% of the Sweep, naming the least amount", async () => {
    const context = await mainnetProvider("oc-refund-fee.near");
    // What 1Click keeps if it refunds from Solana, read from a live quote.
    context.oneClick.refundFee = 221_292n;
    const plan = (amount: string) =>
      planSweep(context.planDeps, {
        ...context.base,
        network: SOLANA,
        amount,
        destinationKind: "intents",
      });

    const small = await plan("1500000");
    const atLeast = await plan("2212920");

    expect(small).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(!small.ok && small.message).toContain("0.221292 USDC");
    expect(!small.ok && small.message).toContain("2.21292 USDC");
    expect(atLeast).toMatchObject({ ok: true, quote: { refundFee: "221292" } });
  });

  test.each([
    {
      case: "1Click can't be reached",
      setup: (oneClick: FakeOneClick) => {
        oneClick.unreachable = true;
      },
      reason: "quote_unavailable",
    },
    {
      case: "1Click refuses the quote",
      setup: (oneClick: FakeOneClick) => {
        oneClick.refusal = { ok: false, reason: "refused", message: "recipient is not valid" };
      },
      reason: "quote_refused",
    },
    {
      case: "the quote takes another amount",
      setup: (oneClick: FakeOneClick) => {
        oneClick.tamper = (quote) => {
          quote.amountIn = "1400000";
        };
      },
      reason: "quote_refused",
    },
    {
      case: "the deposit address isn't an address on the source chain",
      setup: (oneClick: FakeOneClick) => {
        oneClick.tamper = (quote) => {
          quote.depositAddress = solanaKeyPair().address;
        };
      },
      reason: "quote_refused",
    },
    {
      case: "the deposit address is the zero address",
      setup: (oneClick: FakeOneClick) => {
        oneClick.tamper = (quote) => {
          quote.depositAddress = "0x0000000000000000000000000000000000000000";
        };
      },
      reason: "quote_refused",
    },
  ])("records nothing when $case", async ({ setup, reason }) => {
    const context = await mainnetProvider(`oc-${reason}-${crypto.randomUUID().slice(0, 8)}.near`);
    setup(context.oneClick);

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "1500000",
      destinationKind: "intents",
    });

    expect(plan).toMatchObject({ ok: false, reason });
    expect(await refreshSweeps(context.deps, context.base)).toEqual([]);
  });

  test.each([
    {
      case: "the source chain itself",
      input: { destinationNetwork: BASE, destination: DESTINATION },
      reason: "invalid_destination",
    },
    {
      case: "the destination chain's USDC contract",
      input: {
        destinationNetwork: ARBITRUM,
        destination: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      },
      reason: "invalid_destination",
    },
    {
      case: "an EVM address on Solana",
      input: { destinationNetwork: SOLANA, destination: DESTINATION },
      reason: "invalid_request",
    },
    {
      case: "a testnet chain",
      input: { destinationNetwork: "eip155:421614", destination: DESTINATION },
      reason: "unsupported_network",
    },
  ])(
    "refuses a cross-chain destination on $case, without asking 1Click",
    async ({ input, reason }) => {
      const context = await mainnetProvider(`oc-dest-${crypto.randomUUID().slice(0, 8)}.near`);

      const plan = await planSweep(context.planDeps, {
        ...context.base,
        network: BASE,
        amount: "1500000",
        destinationKind: "cross_chain",
        ...input,
      });

      expect(plan).toMatchObject({ ok: false, reason });
      expect(context.oneClick.quotes).toEqual([]);
    },
  );

  test("accepts the Provider's own Receiving Address on another chain: that's consolidating", async () => {
    const context = await mainnetProvider("oc-consolidate.near");

    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "1500000",
      destinationKind: "cross_chain",
      destinationNetwork: SOLANA,
      destination: context.provider.solanaAddress,
    });

    expect(plan).toMatchObject({
      ok: true,
      sweep: { destinationAddress: context.provider.solanaAddress },
    });
  });

  test("on testnet, refuses both 1Click kinds: 1Click runs on mainnet only", async () => {
    const context = await mainnetProvider("oc-testnet.testnet");

    const plan = await planSweep(context.planDeps, {
      providerId: context.provider.id,
      env: "testnet",
      network: "eip155:84532",
      amount: "1500000",
      destinationKind: "intents",
    });

    expect(plan).toMatchObject({ ok: false, reason: "unsupported_destination" });
    expect(context.oneClick.quotes).toEqual([]);
  });
});

describe("getSweepOptions", () => {
  test("marks every mainnet chain as one 1Click can Sweep from and to", async () => {
    const context = await mainnetProvider("oc-options.near");

    const options = await getSweepOptions(
      { db: db(), readUsdcBalance: context.planDeps.readUsdcBalance },
      context.base,
    );

    expect(options?.chains.map((c) => [c.label, c.oneClick])).toEqual([
      ["Base", true],
      ["Solana", true],
      ["Arbitrum", true],
      ["Polygon", true],
      ["Avalanche", true],
    ]);
  });
});

describe("completing a cross-chain Sweep", () => {
  test("submits the signed transfer to 1Click's deposit address", async () => {
    const context = await mainnetProvider("oc-complete.near");

    const { depositAddress } = await submittedSweep(context);

    expect(context.queue.submissions).toHaveLength(1);
    const call = decodeFunctionData({ abi: eip3009ABI, data: context.queue.submissions[0]!.data });
    const [from, to, value] = call.args as unknown as [Address, Address, bigint];
    expect({ from: from.toLowerCase(), to: to.toLowerCase(), value }).toEqual({
      from: context.provider.evmAddress,
      to: depositAddress.toLowerCase(),
      value: 1_500_000n,
    });
  });

  test("fails a quote left unsigned past its signing window, and leaves it out of the list", async () => {
    const context = await mainnetProvider("oc-expired.near");
    const { sweep, signRequest } = await planBaseToArbitrum(context);
    const later = new Date((sweep.validBefore + 1) * 1000);

    const listed = await refreshSweeps(context.deps, { ...context.base, now: later });
    // Signing it now is too late: the Sweep says why it failed.
    const nearTxHash = await context.near.sign({
      signerId: context.provider.accountId,
      request: signRequest,
      key: context.receivingKey,
    });
    const late = await completeSweep(context.deps, {
      ...context.base,
      sweepId: sweep.id,
      nearTxHash,
      now: later,
    });

    expect(listed).toEqual([]);
    expect(late).toMatchObject({ ok: true, sweep: { id: sweep.id, status: "failed" } });
    expect(late.ok && late.sweep.error).toContain("1Click quote expired");
    expect(context.queue.submissions).toEqual([]);
  });

  test("a discarded quote can't be signed later, and isn't listed", async () => {
    const context = await mainnetProvider("oc-discarded.near");
    const { sweep, signRequest } = await planBaseToArbitrum(context);

    const discarded = await discardSweep(db(), {
      providerId: context.provider.id,
      sweepId: sweep.id,
    });
    const again = await discardSweep(db(), { providerId: context.provider.id, sweepId: sweep.id });
    const nearTxHash = await context.near.sign({
      signerId: context.provider.accountId,
      request: signRequest,
      key: context.receivingKey,
    });
    const signed = await completeSweep(context.deps, {
      ...context.base,
      sweepId: sweep.id,
      nearTxHash,
    });

    expect([discarded, again]).toEqual([true, false]);
    expect(signed).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(signed.ok && signed.sweep.error).toContain("discarded");
    expect(context.queue.submissions).toEqual([]);
    expect(await refreshSweeps(context.deps, context.base)).toEqual([]);
  });

  test("only the Provider who planned a Sweep can discard it", async () => {
    const context = await mainnetProvider("oc-discard-owner.near");
    const other = await sweepingProvider("oc-discard-other.near");
    const { sweep } = await planBaseToArbitrum(context);

    const byOther = await discardSweep(db(), { providerId: other.provider.id, sweepId: sweep.id });
    const byOwner = await discardSweep(db(), {
      providerId: context.provider.id,
      sweepId: sweep.id,
    });

    expect([byOther, byOwner]).toEqual([false, true]);
  });

  test("lists a 1Click Sweep once its signing transaction is sent", async () => {
    const context = await mainnetProvider("oc-listed.near");
    const { sweep } = await submittedSweep(context);

    const listed = await refreshSweeps(context.deps, context.base);

    expect(listed.map((s) => s.id)).toEqual([sweep.id]);
  });

  test("doesn't submit a signature that arrives after the quote's signing window", async () => {
    const context = await mainnetProvider("oc-late.near");
    const { sweep, signRequest } = await planBaseToArbitrum(context);
    const nearTxHash = await context.near.sign({
      signerId: context.provider.accountId,
      request: signRequest,
      key: context.receivingKey,
    });

    const result = await completeSweep(context.deps, {
      ...context.base,
      sweepId: sweep.id,
      nearTxHash,
      now: new Date((sweep.validBefore + 1) * 1000),
    });

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(result.ok && result.sweep.error).toContain("1Click quote expired");
    expect(context.queue.submissions).toEqual([]);
  });
});

describe("following a cross-chain Sweep through 1Click", () => {
  test("goes confirmed, delivering, delivered as 1Click picks up the deposit and delivers it", async () => {
    const context = await mainnetProvider("oc-delivered.near");
    const { sweep, depositAddress } = await confirmedSweep(context);

    const notSeenYet = await context.refresh();
    context.oneClick.report(depositAddress, "PENDING_DEPOSIT");
    const pending = await context.refresh();
    context.oneClick.report(depositAddress, "PROCESSING");
    const delivering = await context.refresh();
    const stillDelivering = await context.refresh();
    const deliveryTx = `0x${"cd".repeat(32)}`;
    context.oneClick.report(depositAddress, "SUCCESS", {
      amountOut: "1499100",
      destinationTxHashes: [deliveryTx],
    });
    const delivered = await context.refresh();

    expect(notSeenYet).toMatchObject({ status: "confirmed" });
    expect(pending).toMatchObject({ status: "confirmed" });
    expect(delivering).toMatchObject({ status: "delivering" });
    expect(stillDelivering).toMatchObject({ status: "delivering" });
    expect(delivered).toMatchObject({
      id: sweep.id,
      status: "delivered",
      deliveredAmount: "1499100",
      deliveryTxHash: deliveryTx,
      deliveryTxUrl: `https://arbiscan.io/tx/${deliveryTx}`,
      destinationLabel: "Arbitrum",
      oneClickUrl: `https://explorer.near-intents.org/transactions/${depositAddress}`,
      error: null,
    });
    // Delivered is final: 1Click isn't asked again.
    context.oneClick.unreachable = true;
    expect(await context.refresh()).toMatchObject({ status: "delivered" });
  });

  test("records a refund to the source Receiving Address", async () => {
    const context = await mainnetProvider("oc-refunded.near");
    const { depositAddress } = await confirmedSweep(context);
    context.oneClick.report(depositAddress, "PROCESSING");
    await context.refresh();
    context.oneClick.report(depositAddress, "REFUNDED", {
      refundedAmount: "1497600",
      refundReason: "SLIPPAGE_EXCEEDED",
    });

    const refunded = await context.refresh();

    expect(refunded).toMatchObject({ status: "refunded", refundedAmount: "1497600" });
    expect(refunded?.error).toContain("1.4976 USDC");
    expect(refunded?.error).toContain("Receiving Address on Base");
  });

  test("a swap 1Click gave up on fails the Sweep", async () => {
    const context = await mainnetProvider("oc-failed.near");
    const { depositAddress } = await confirmedSweep(context);
    context.oneClick.report(depositAddress, "FAILED");

    const failed = await context.refresh();

    expect(failed).toMatchObject({ status: "failed" });
    expect(failed?.error).toContain("1Click");
  });

  test("stops waiting for a deposit 1Click never picks up, an hour after the quote's deadline", async () => {
    const context = await mainnetProvider("oc-never-seen.near");
    const { sweep, depositAddress } = await confirmedSweep(context);
    const deadline = sweep.quoteDeadline!.getTime();
    const refreshAt = async (ms: number) =>
      (await refreshSweeps(context.deps, { ...context.base, now: new Date(ms) }))[0];

    const unknownAtDeadline = await refreshAt(deadline);
    context.oneClick.report(depositAddress, "PENDING_DEPOSIT");
    const pendingInGrace = await refreshAt(deadline + (ONE_CLICK_PICKUP_GRACE_SECONDS - 1) * 1000);
    const pastGrace = await refreshAt(deadline + ONE_CLICK_PICKUP_GRACE_SECONDS * 1000);

    expect(unknownAtDeadline).toMatchObject({ status: "confirmed" });
    expect(pendingInGrace).toMatchObject({ status: "confirmed" });
    expect(pastGrace).toMatchObject({ status: "failed" });
    expect(pastGrace?.error).toContain(depositAddress);
  });

  test("keeps following a swap 1Click is delivering, even past the quote's deadline", async () => {
    const context = await mainnetProvider("oc-slow-delivery.near");
    const { sweep, depositAddress } = await confirmedSweep(context);
    context.oneClick.report(depositAddress, "PROCESSING");
    await context.refresh();
    const muchLater = sweep.quoteDeadline!.getTime() + 2 * ONE_CLICK_PICKUP_GRACE_SECONDS * 1000;

    const [stillDelivering] = await refreshSweeps(context.deps, {
      ...context.base,
      now: new Date(muchLater),
    });

    expect(stillDelivering).toMatchObject({ status: "delivering" });
  });

  test("leaves the Sweep as it is while 1Click can't be reached", async () => {
    const context = await mainnetProvider("oc-status-down.near");
    const { depositAddress } = await confirmedSweep(context);
    context.oneClick.report(depositAddress, "SUCCESS", { amountOut: "1499000" });
    context.oneClick.unreachable = true;

    const unreachable = await context.refresh();
    context.oneClick.unreachable = false;
    const reachable = await context.refresh();

    expect(unreachable).toMatchObject({ status: "confirmed" });
    expect(reachable).toMatchObject({ status: "delivered" });
  });

  test("a same-chain Sweep is done once confirmed and never asks 1Click", async () => {
    const context = await mainnetProvider("oc-same-chain.near");
    context.oneClick.unreachable = true;
    const plan = await planSweep(context.planDeps, {
      ...context.base,
      network: BASE,
      amount: "1500000",
      destination: DESTINATION,
    });
    if (!plan.ok) throw new Error(plan.message);
    const nearTxHash = await context.near.sign({
      signerId: context.provider.accountId,
      request: plan.signRequest,
      key: context.receivingKey,
    });
    const completed = await completeSweep(context.deps, {
      ...context.base,
      sweepId: plan.sweep.id,
      nearTxHash,
    });
    if (!completed.ok) throw new Error(completed.message);
    context.receipts.receipts[completed.sweep.sourceTxHash!] = "success";

    const confirmed = await context.refresh();

    expect(plan.quote).toBeNull();
    expect(confirmed).toMatchObject({ status: "confirmed", oneClickUrl: null });
  });
});
