import { createDb, sweeps } from "@herald/db";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  KeyType,
  PublicKey,
} from "near-api-js";
import type { Hex } from "viem";
import { describe, expect, test } from "vite-plus/test";
import { completeSweep, planSweep, refreshSweeps } from "../src/server/index.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeNearUsdc,
  FakeOneClick,
  FakeSolana,
  fakeReceipts,
  solanaKeyPair,
  sweepingProvider,
  usdcBalances,
} from "./support/sweeps.ts";

const db = () => createDb(env.DB);

const NEAR_TESTNET = "near:testnet";
const NEAR_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
/** A named account registered on USDC. */
const DESTINATION = "alice.testnet";

/**
 * A Provider with USDC on NEAR Testnet, its NEAR Receiving Address set up
 * on a fake NEAR, and a destination registered on USDC.
 */
async function nearProvider(accountId: string, balance = "5000000") {
  const context = await sweepingProvider(accountId);
  const chain = new FakeNearUsdc();
  chain.addAccount(context.provider.nearAddress);
  chain.registered.add(DESTINATION);
  const solana = new FakeSolana();
  const near = new FakeNear();
  const planDeps = {
    db: db(),
    readUsdcBalance: usdcBalances({ [context.provider.nearAddress]: balance }),
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: chain.reader,
    nearQueue: chain.queue,
    oneClick: new FakeOneClick().client,
  };
  const sweepDeps = {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: new FakeChainQueue().submit,
    readReceipt: fakeReceipts().read,
    readSolana: solana.reader,
    solanaQueue: solana.queue,
    readNear: chain.reader,
    nearQueue: chain.queue,
    oneClick: new FakeOneClick().client,
  };
  const plan = (input: { amount?: string; destination?: string; now?: Date } = {}) =>
    planSweep(planDeps, {
      providerId: context.provider.id,
      env: "testnet",
      network: NEAR_TESTNET,
      amount: input.amount ?? "1500000",
      destination: input.destination ?? DESTINATION,
      now: input.now,
    });
  return { ...context, chain, near, planDeps, sweepDeps, plan };
}

function nearPlan(plan: Awaited<ReturnType<typeof planSweep>>) {
  if (!plan.ok) throw new Error(plan.message);
  if (plan.sweep.sourceKind !== "near") throw new Error("Expected a NEAR Sweep");
  return { sweep: plan.sweep, signRequest: plan.signRequest };
}

/** The delegate action a NEAR Sweep should be, built with near-api-js (signable form, NEP-461 prefix included). */
function expectedDelegate(input: {
  sender: string;
  receiver: string;
  amount: string;
  nonce: bigint;
  maxBlockHeight: bigint;
}): Uint8Array {
  return encodeDelegateAction(
    buildDelegateAction({
      senderId: input.sender,
      receiverId: NEAR_USDC,
      actions: [
        actions.functionCall(
          "ft_transfer",
          { receiver_id: input.receiver, amount: input.amount },
          30_000_000_000_000n,
          1n,
        ),
      ],
      nonce: input.nonce,
      maxBlockHeight: input.maxBlockHeight,
      publicKey: new PublicKey({ keyType: KeyType.ED25519, data: hexToBytes(input.sender) }),
    }),
  );
}

describe("planning a NEAR Sweep", () => {
  test("plans a delegate action from the NEAR Receiving Address with one ft_transfer, for the MPC signer to sign its NEP-461 hash", async () => {
    const { provider, chain, plan } = await nearProvider("near-plan.testnet");
    const keyNonce = chain.keyNonceOf(provider.nearAddress)!;
    const now = new Date("2026-11-12T12:00:00Z");

    const { sweep, signRequest } = nearPlan(await plan({ now }));

    expect(sweep).toMatchObject({
      providerId: provider.id,
      sourceKind: "near",
      sourceNetwork: NEAR_TESTNET,
      asset: NEAR_USDC,
      amount: "1500000",
      destinationKind: "same_chain",
      destinationNetwork: NEAR_TESTNET,
      destinationAddress: DESTINATION,
      status: "planned",
      nearNonce: Number(keyNonce + 1n),
      // Ten minutes to sign, like an EVM Sweep's window. The delegate action
      // lasts ten minutes of 0.5 s blocks, faster than NEAR's, so it can't
      // expire on chain before the deadline Herald shows.
      nearMaxBlockHeight: chain.height + 1200,
      validBefore: now.getTime() / 1000 + 600,
    });
    const signable = expectedDelegate({
      sender: provider.nearAddress,
      receiver: DESTINATION,
      amount: "1500000",
      nonce: keyNonce + 1n,
      maxBlockHeight: BigInt(chain.height + 1200),
    });
    // Stored without the 4-byte NEP-461 prefix, as it sits in a signed delegate action.
    expect(base64.decode(sweep.nearDelegateAction)).toEqual(signable.slice(4));
    const hash = bytesToHex(sha256(signable));
    expect(sweep.payloadHash).toBe(`0x${hash}`);
    // The MPC signer signs the hash with the NEAR Receiving Address's key:
    // path near-1, EdDSA domain 1.
    expect(signRequest).toEqual({
      contractId: "v1.signer-prod.testnet",
      methodName: "sign",
      args: { request: { payload_v2: { Eddsa: hash }, path: "near-1", domain_id: 1 } },
      deposit: "1",
      gas: expect.any(String),
    });
    expect(BigInt(signRequest.gas)).toBeGreaterThanOrEqual(15_000_000_000_000n);
  });

  test("gives a second NEAR Sweep planned before the first lands the next nonce, so both can land", async () => {
    const { provider, chain, plan } = await nearProvider("near-plan-nonces.testnet");
    const keyNonce = chain.keyNonceOf(provider.nearAddress)!;

    const first = nearPlan(await plan());
    const second = nearPlan(await plan());

    expect(first.sweep.nearNonce).toBe(Number(keyNonce + 1n));
    expect(second.sweep.nearNonce).toBe(Number(keyNonce + 2n));
  });

  test("refuses an amount below NEAR's 0.001 USDC minimum and accepts the minimum itself", async () => {
    const { plan } = await nearProvider("near-plan-minimum.testnet");

    const below = await plan({ amount: "999" });
    const atMinimum = await plan({ amount: "1000" });

    expect(below).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(!below.ok && below.message).toContain("0.001");
    expect(atMinimum.ok).toBe(true);
  });

  test("refuses more than the NEAR Receiving Address holds", async () => {
    const { plan } = await nearProvider("near-plan-balance.testnet", "1000000");

    expect(await plan({ amount: "1000001" })).toMatchObject({
      ok: false,
      reason: "insufficient_balance",
    });
  });

  test("refuses to plan when NEAR can't be read", async () => {
    const { chain, plan } = await nearProvider("near-plan-down.testnet");
    chain.readsFail = true;

    expect(await plan()).toMatchObject({ ok: false, reason: "chain_unavailable" });
  });

  test("refuses to plan before the NEAR Receiving Address is set up", async () => {
    const { provider, planDeps } = await nearProvider("near-plan-not-set-up.testnet");
    // A NEAR on which Herald never created the implicit account.
    const chain = new FakeNearUsdc();
    chain.registered.add(DESTINATION);

    const result = await planSweep(
      { ...planDeps, readNear: chain.reader, nearQueue: chain.queue },
      {
        providerId: provider.id,
        env: "testnet",
        network: NEAR_TESTNET,
        amount: "150000",
        destination: DESTINATION,
      },
    );

    expect(result).toMatchObject({ ok: false, reason: "chain_unavailable" });
    expect(!result.ok && result.message).toContain("isn't set up");
  });

  test.each([
    { id: "invalid", case: "not a NEAR account id", reason: "invalid_request" },
    { id: "solana", case: "a Solana address", reason: "invalid_request" },
    { id: "own", case: "the NEAR Receiving Address itself", reason: "invalid_destination" },
    { id: "usdc", case: "the USDC contract", reason: "invalid_destination" },
    { id: "unregistered", case: "not registered on USDC", reason: "invalid_destination" },
    { id: "relayer", case: "Herald's relayer", reason: "invalid_destination" },
  ])("refuses a destination that is $case, and records nothing", async ({ id, reason }) => {
    const { provider, chain, plan } = await nearProvider(`near-plan-destination-${id}.testnet`);
    chain.registered.add(chain.relayer);
    const destinations: Record<string, string> = {
      invalid: "Not An Account!",
      solana: solanaKeyPair().address,
      own: provider.nearAddress,
      usdc: NEAR_USDC,
      unregistered: "bob.testnet",
      relayer: chain.relayer,
    };

    const result = await plan({ destination: destinations[id]! });

    expect(result).toMatchObject({ ok: false, reason });
    if (id === "invalid") expect(!result.ok && result.message).toContain("NEAR account id");
    if (id === "unregistered") expect(!result.ok && result.message).toContain("registered");
    expect(await db().select().from(sweeps).where(eq(sweeps.providerId, provider.id))).toEqual([]);
  });
});

/** A Provider's planned NEAR Sweep, with everything completing it needs. */
async function plannedNearSweep(accountId: string) {
  const context = await nearProvider(accountId);
  const plan = nearPlan(await context.plan());
  const sign = (options: { key?: Uint8Array; payload?: Hex; pending?: boolean } = {}) =>
    context.near.sign({
      signerId: context.provider.accountId,
      request: plan.signRequest,
      key: options.key ?? context.nearKey,
      payload: options.payload,
      pending: options.pending,
    });
  const complete = (nearTxHash: string, now?: Date) =>
    completeSweep(context.sweepDeps, {
      providerId: context.provider.id,
      env: "testnet",
      sweepId: plan.sweep.id,
      nearTxHash,
      now,
    });
  const refresh = async (now?: Date) =>
    (
      await refreshSweeps(context.sweepDeps, {
        providerId: context.provider.id,
        env: "testnet",
        now,
      })
    )[0];
  return { ...context, ...plan, sign, complete, refresh };
}

describe("completing a NEAR Sweep", () => {
  test("reads the Ed25519 signature from the NEAR transaction and hands the signed delegate action to the NEAR chain queue", async () => {
    const { provider, chain, sweep, sign, complete } =
      await plannedNearSweep("near-complete.testnet");
    const nearTxHash = await sign();

    const result = await complete(nearTxHash);

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep).toMatchObject({ status: "submitted", nearTxHash, error: null });
    expect(chain.submissions).toHaveLength(1);
    const [submission] = chain.submissions;
    expect(submission?.network).toBe(NEAR_TESTNET);
    expect(result.sweep.sourceTxHash).toEqual(expect.any(String));
    // The planned delegate action, then an ed25519 signature (key type 0)
    // by the NEAR Receiving Address over its NEP-461 hash.
    const signed = base64.decode(submission!.signedDelegateAction);
    const unsigned = base64.decode(sweep.nearDelegateAction);
    expect(signed.slice(0, unsigned.length)).toEqual(unsigned);
    expect(signed[unsigned.length]).toBe(0);
    const signature = signed.slice(unsigned.length + 1);
    expect(signature).toHaveLength(64);
    expect(
      ed25519.verify(
        signature,
        hexToBytes(sweep.payloadHash.slice(2)),
        hexToBytes(provider.nearAddress),
      ),
    ).toBe(true);
  });

  test("rejects a signature by another key, and submits nothing", async () => {
    const { chain, sign, complete } = await plannedNearSweep("near-complete-wrong-key.testnet");
    const nearTxHash = await sign({ key: solanaKeyPair().secretKey });

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed", sourceTxHash: null } });
    expect(result.ok && result.sweep.error).toContain("isn't your Receiving Address's signature");
    expect(chain.submissions).toEqual([]);
  });

  test("rejects a NEAR transaction that signed another delegate action, such as a transfer to someone else", async () => {
    const { chain, sign, complete } = await plannedNearSweep("near-complete-substituted.testnet");
    const other = await plannedNearSweep("near-complete-substituted-other.testnet");
    const nearTxHash = await sign({ payload: other.sweep.payloadHash as Hex });

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(chain.submissions).toEqual([]);
  });

  test("a Sweep the NEAR chain queue refuses fails", async () => {
    const { chain, sign, complete } = await plannedNearSweep("near-complete-refused.testnet");
    chain.refuseWith = "The signed delegate action expired at block 200001000";
    const nearTxHash = await sign();

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({
      ok: true,
      sweep: { status: "failed", sourceTxHash: null, submittedAt: null },
    });
    expect(result.ok && result.sweep.error).toContain("expired at block");
  });

  test("an unreachable NEAR chain queue leaves the Sweep awaiting its signature, and a refresh submits it", async () => {
    const { sweep, chain, sign, complete, refresh } = await plannedNearSweep(
      "near-complete-unreachable.testnet",
    );
    chain.queueUnreachable = true;
    const nearTxHash = await sign();

    const first = await complete(nearTxHash);
    chain.queueUnreachable = false;
    const refreshed = await refresh();

    expect(first).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(refreshed).toMatchObject({ id: sweep.id, status: "submitted" });
    expect(chain.submissions).toHaveLength(1);
  });

  test("sending the NEAR transaction hash again doesn't submit the Sweep again", async () => {
    const { chain, sign, complete } = await plannedNearSweep("near-complete-twice.testnet");
    const nearTxHash = await sign();

    const first = await complete(nearTxHash);
    const again = await complete(nearTxHash);

    expect(first).toMatchObject({ ok: true, sweep: { status: "submitted" } });
    expect(again).toMatchObject({
      ok: true,
      sweep: { status: "submitted", sourceTxHash: first.ok ? first.sweep.sourceTxHash : null },
    });
    expect(chain.submissions).toHaveLength(1);
  });
});

describe("following a NEAR Sweep", () => {
  test("goes from a signature the MPC network is still producing to a confirmed transfer, with NEAR transaction links", async () => {
    const { sweep, chain, near, nearKey, sign, complete, refresh } = await plannedNearSweep(
      "near-refresh-confirmed.testnet",
    );
    const nearTxHash = await sign({ pending: true });

    const completed = await complete(nearTxHash);
    const stillSigning = await refresh();
    await near.finish(nearTxHash, sweep.payloadHash as Hex, nearKey);
    const submitted = await refresh();
    const notExecutedYet = await refresh();
    chain.statuses.set(submitted!.sourceTxHash!, { kind: "success" });
    const confirmed = await refresh();

    expect(completed).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(stillSigning).toMatchObject({ status: "awaiting_signature" });
    expect(submitted).toMatchObject({ status: "submitted" });
    expect(notExecutedYet).toMatchObject({ status: "submitted" });
    expect(confirmed).toMatchObject({
      id: sweep.id,
      status: "confirmed",
      label: "NEAR Testnet",
      destinationLabel: "NEAR Testnet",
      nearTxHash,
      nearTxUrl: `https://testnet.nearblocks.io/txns/${nearTxHash}`,
      sourceTxHash: submitted!.sourceTxHash,
      sourceTxUrl: `https://testnet.nearblocks.io/txns/${submitted!.sourceTxHash}`,
    });
  });

  test("a failed ft_transfer fails the Sweep", async () => {
    const { chain, sign, complete, refresh } = await plannedNearSweep(
      "near-refresh-failed.testnet",
    );
    const completed = await complete(await sign());
    if (!completed.ok) throw new Error(completed.message);
    chain.statuses.set(completed.sweep.sourceTxHash!, {
      kind: "failure",
      error:
        '{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: The account alice.testnet is not registered"}}}}',
    });

    const refreshed = await refresh();

    expect(refreshed).toMatchObject({ status: "failed" });
    expect(refreshed?.error).toContain("failed on NEAR Testnet");
  });

  test("a relayed Sweep that never executes fails once the chain is well past its delegate action's expiry, and not before", async () => {
    const { sweep, chain, sign, complete, refresh } = await plannedNearSweep(
      "near-refresh-expired.testnet",
    );
    await complete(await sign());

    chain.height = sweep.nearMaxBlockHeight + 1;
    const justPastIt = await refresh();
    chain.height = sweep.nearMaxBlockHeight + 1000;
    const wellPastIt = await refresh();

    expect(justPastIt).toMatchObject({ status: "submitted" });
    expect(wellPastIt).toMatchObject({ status: "failed" });
    expect(wellPastIt?.error).toContain("expired");
  });

  test("a Sweep nobody signed fails once its delegate action should have expired", async () => {
    const { sweep, refresh } = await plannedNearSweep("near-refresh-unsigned.testnet");

    const beforeExpiry = await refresh(new Date((sweep.validBefore - 1) * 1000));
    const afterExpiry = await refresh(new Date(sweep.validBefore * 1000));

    expect(beforeExpiry).toMatchObject({ status: "planned" });
    expect(afterExpiry).toMatchObject({ status: "failed" });
    expect(afterExpiry?.error).toContain("delegate action");
  });

  test("a signature still missing when the delegate action expires fails the Sweep, and submits nothing", async () => {
    const { sweep, chain, sign, complete, refresh } = await plannedNearSweep(
      "near-refresh-unsigned-pending.testnet",
    );
    await complete(await sign({ pending: true }));

    const expired = await refresh(new Date(sweep.validBefore * 1000));

    expect(expired).toMatchObject({ status: "failed" });
    expect(chain.submissions).toEqual([]);
  });
});

describe("the daily cap", () => {
  test("counts NEAR Sweeps: once 10 went out, no more are planned", async () => {
    const context = await nearProvider("near-cap.testnet");
    for (let i = 0; i < 10; i++) {
      const { sweep, signRequest } = nearPlan(await context.plan({ amount: "1000" }));
      const nearTxHash = await context.near.sign({
        signerId: context.provider.accountId,
        request: signRequest,
        key: context.nearKey,
      });
      await completeSweep(context.sweepDeps, {
        providerId: context.provider.id,
        env: "testnet",
        sweepId: sweep.id,
        nearTxHash,
      });
    }

    const eleventh = await context.plan({ amount: "1000" });

    expect(context.chain.submissions).toHaveLength(10);
    expect(eleventh).toMatchObject({ ok: false, reason: "daily_cap_reached" });
  });
});
