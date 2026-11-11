import { createDb } from "@herald/db";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  AssociatedTokenInstruction,
  identifyAssociatedTokenInstruction,
  identifyTokenInstruction,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
} from "@solana-program/token";
import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getTransactionDecoder,
} from "@solana/kit";
import { base58 } from "@scure/base";
import { env } from "cloudflare:workers";
import type { Hex } from "viem";
import { describe, expect, test } from "vite-plus/test";
import type { SolanaSweep } from "../src/index.ts";
import {
  completeSweep,
  planSweep,
  refreshSweeps,
  type MpcSignRequest,
} from "../src/server/index.ts";
import {
  FakeChainQueue,
  FakeNear,
  FakeSolana,
  fakeReceipts,
  solanaKeyPair,
  SYSTEM_PROGRAM,
  sweepingProvider,
  tokenAccountOf,
  usdcBalances,
} from "./support/sweeps.ts";

const db = () => createDb(env.DB);

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** A Provider with USDC on Solana Devnet, a fake Solana with its token account, and a destination wallet. */
async function solanaProvider(accountId: string, balance = "5000000") {
  const context = await sweepingProvider(accountId);
  const solana = new FakeSolana();
  await solana.addTokenAccount(context.provider.solanaAddress, DEVNET_USDC);
  const destination = solanaKeyPair().address;
  solana.accounts.set(destination, SYSTEM_PROGRAM);
  const deps = {
    db: db(),
    readUsdcBalance: usdcBalances({ [context.provider.solanaAddress]: balance }),
    readSolana: solana.reader,
    solanaQueue: solana.queue,
  };
  return { ...context, solana, destination, deps };
}

/** The planned transaction, decoded: its message bytes, signers and instructions. */
function decodePlanned(sweep: SolanaSweep) {
  const transaction = getTransactionDecoder().decode(
    getBase64Encoder().encode(sweep.solanaTransaction),
  );
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  return {
    messageBytes: new Uint8Array(transaction.messageBytes),
    signatures: transaction.signatures,
    feePayer: compiled.staticAccounts[0],
    instructions: getInstructionsFromCompiledTransactionMessage(compiled),
  };
}

function solanaPlan(plan: Awaited<ReturnType<typeof planSweep>>) {
  if (!plan.ok) throw new Error(plan.message);
  if (plan.sweep.sourceKind !== "solana") throw new Error("Expected a Solana Sweep");
  return { sweep: plan.sweep, signRequest: plan.signRequest };
}

describe("planning a Solana Sweep", () => {
  test("plans an SPL transfer between the token accounts, paid for by Herald's gas wallet, for the MPC signer to sign", async () => {
    const { provider, solana, destination, deps } = await solanaProvider("sol-plan.testnet");
    await solana.addTokenAccount(destination, DEVNET_USDC);
    const now = new Date("2026-11-11T12:00:00Z");

    const { sweep, signRequest } = solanaPlan(
      await planSweep(deps, {
        providerId: provider.id,
        env: "testnet",
        network: SOLANA_DEVNET,
        amount: "1500000",
        destination,
        now,
      }),
    );

    expect(sweep).toMatchObject({
      providerId: provider.id,
      sourceKind: "solana",
      sourceNetwork: SOLANA_DEVNET,
      asset: DEVNET_USDC,
      amount: "1500000",
      destinationKind: "same_chain",
      destinationNetwork: SOLANA_DEVNET,
      destinationAddress: destination,
      status: "planned",
      lastValidBlockHeight: solana.blockHeight + 150,
    });
    // About a blockhash's lifetime from when it was planned.
    const nowSeconds = now.getTime() / 1000;
    expect(sweep.validBefore).toBeGreaterThan(nowSeconds + 30);
    expect(sweep.validBefore).toBeLessThanOrEqual(nowSeconds + 120);

    const planned = decodePlanned(sweep);
    // Herald's gas wallet pays the fee; the Receiving Address signs too.
    expect(planned.feePayer).toBe(solana.feePayer);
    expect(Object.keys(planned.signatures)).toEqual([solana.feePayer, provider.solanaAddress]);
    expect(Object.values(planned.signatures)).toEqual([null, null]);
    // One USDC TransferChecked, from the Receiving Address's token account
    // to the destination's, authorized by the Receiving Address.
    expect(planned.instructions).toHaveLength(1);
    const [instruction] = planned.instructions;
    expect(instruction?.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(identifyTokenInstruction(instruction!.data!)).toBe(TokenInstruction.TransferChecked);
    const transfer = parseTransferCheckedInstruction(instruction as never);
    expect({
      source: transfer.accounts.source.address,
      mint: transfer.accounts.mint.address,
      destination: transfer.accounts.destination.address,
      authority: transfer.accounts.authority.address,
      amount: transfer.data.amount,
      decimals: transfer.data.decimals,
    }).toEqual({
      source: await tokenAccountOf(provider.solanaAddress, DEVNET_USDC),
      mint: DEVNET_USDC,
      destination: await tokenAccountOf(destination, DEVNET_USDC),
      authority: provider.solanaAddress,
      amount: 1_500_000n,
      decimals: 6,
    });
    // The MPC signer signs the message bytes with the Solana Receiving
    // Address's key: path solana-1, EdDSA domain 1.
    expect(signRequest).toEqual({
      contractId: "v1.signer-prod.testnet",
      methodName: "sign",
      args: {
        request: {
          payload_v2: { Eddsa: Buffer.from(planned.messageBytes).toString("hex") },
          path: "solana-1",
          domain_id: 1,
        },
      },
      deposit: "1",
      gas: expect.any(String),
    });
    expect(BigInt(signRequest.gas)).toBeGreaterThanOrEqual(15_000_000_000_000n);
  });

  test("creates the destination's USDC token account first when it has none, with Herald paying the rent", async () => {
    const { provider, solana, destination, deps } = await solanaProvider("sol-plan-ata.testnet");

    const { sweep } = solanaPlan(
      await planSweep(deps, {
        providerId: provider.id,
        env: "testnet",
        network: SOLANA_DEVNET,
        amount: "150000",
        destination,
      }),
    );

    const { instructions } = decodePlanned(sweep);
    expect(instructions.map((i) => i.programAddress)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
    ]);
    const [create, transfer] = instructions;
    expect(identifyAssociatedTokenInstruction(create as never)).toBe(
      AssociatedTokenInstruction.CreateAssociatedTokenIdempotent,
    );
    const created = parseCreateAssociatedTokenIdempotentInstruction(create as never);
    const destinationTokenAccount = await tokenAccountOf(destination, DEVNET_USDC);
    expect({
      payer: created.accounts.payer.address,
      owner: created.accounts.owner.address,
      mint: created.accounts.mint.address,
      ata: created.accounts.ata.address,
    }).toEqual({
      payer: solana.feePayer,
      owner: destination,
      mint: DEVNET_USDC,
      ata: destinationTokenAccount,
    });
    expect(parseTransferCheckedInstruction(transfer as never).accounts.destination.address).toBe(
      destinationTokenAccount,
    );
  });

  test("refuses an amount below Solana's minimum and accepts the minimum itself", async () => {
    const { provider, destination, deps } = await solanaProvider("sol-plan-minimum.testnet");
    const plan = (amount: string) =>
      planSweep(deps, {
        providerId: provider.id,
        env: "testnet",
        network: SOLANA_DEVNET,
        amount,
        destination,
      });

    // Solana Devnet's seeded minimum is 0.001 USDC.
    const below = await plan("999");
    const atMinimum = await plan("1000");

    expect(below).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(!below.ok && below.message).toContain("0.001");
    expect(atMinimum.ok).toBe(true);
  });

  test("refuses more than the Solana Receiving Address holds", async () => {
    const { provider, destination, deps } = await solanaProvider(
      "sol-plan-balance.testnet",
      "1000000",
    );

    const plan = await planSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      network: SOLANA_DEVNET,
      amount: "1000001",
      destination,
    });

    expect(plan).toMatchObject({ ok: false, reason: "insufficient_balance" });
  });

  test("refuses to plan when Solana can't be read", async () => {
    const { provider, solana, destination, deps } = await solanaProvider("sol-plan-down.testnet");
    solana.readsFail = true;

    const plan = await planSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      network: SOLANA_DEVNET,
      amount: "150000",
      destination,
    });

    expect(plan).toMatchObject({ ok: false, reason: "chain_unavailable" });
  });

  test.each([
    { id: "own", case: "the Receiving Address itself", reason: "invalid_destination" },
    { id: "mint", case: "the USDC mint", reason: "invalid_destination" },
    { id: "token", case: "a token account, not a wallet", reason: "invalid_destination" },
    { id: "payer", case: "Herald's fee payer", reason: "invalid_destination" },
    { id: "system", case: "the System Program", reason: "invalid_destination" },
    { id: "evm", case: "an EVM address", reason: "invalid_request" },
  ])("refuses a destination that is $case", async ({ id, reason }) => {
    const context = await solanaProvider(`sol-plan-destination-${id}.testnet`);
    const { provider, solana, deps } = context;
    const destinations: Record<string, string> = {
      own: provider.solanaAddress,
      mint: DEVNET_USDC,
      token: await solana.addTokenAccount(context.destination, DEVNET_USDC),
      payer: solana.feePayer,
      system: SYSTEM_PROGRAM,
      evm: "0x000000000000000000000000000000000000d00d",
    };

    const plan = await planSweep(deps, {
      providerId: provider.id,
      env: "testnet",
      network: SOLANA_DEVNET,
      amount: "150000",
      destination: destinations[id]!,
    });

    expect(plan).toMatchObject({ ok: false, reason });
  });
});

/** A Provider's planned Solana Sweep, with everything completing it needs. */
async function plannedSolanaSweep(accountId: string) {
  const context = await solanaProvider(accountId);
  const plan = solanaPlan(
    await planSweep(context.deps, {
      providerId: context.provider.id,
      env: "testnet",
      network: SOLANA_DEVNET,
      amount: "1500000",
      destination: context.destination,
    }),
  );
  const near = new FakeNear();
  const deps = {
    db: db(),
    readNearTransaction: near.readTransaction,
    submitSweep: new FakeChainQueue().submit,
    readReceipt: fakeReceipts().read,
    readSolana: context.solana.reader,
    solanaQueue: context.solana.queue,
  };
  const sign = (options: { key?: Uint8Array; payload?: Hex; pending?: boolean } = {}) =>
    near.sign({
      signerId: context.provider.accountId,
      request: plan.signRequest,
      key: options.key ?? context.solanaKey,
      payload: options.payload,
      pending: options.pending,
    });
  const complete = (nearTxHash: string) =>
    completeSweep(deps, {
      providerId: context.provider.id,
      env: "testnet",
      sweepId: plan.sweep.id,
      nearTxHash,
    });
  const refresh = async () =>
    (await refreshSweeps(deps, { providerId: context.provider.id, env: "testnet" }))[0];
  return { ...context, ...plan, near, deps, sign, complete, refresh };
}

describe("completing a Solana Sweep", () => {
  test("reads the Ed25519 signature from the NEAR transaction and hands the signed transfer to the Solana chain queue", async () => {
    const { provider, solana, sweep, sign, complete } =
      await plannedSolanaSweep("sol-complete.testnet");
    const nearTxHash = await sign();

    const result = await complete(nearTxHash);

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep).toMatchObject({ status: "submitted", nearTxHash, error: null });
    expect(solana.submissions).toHaveLength(1);
    const [submission] = solana.submissions;
    expect(submission?.network).toBe(SOLANA_DEVNET);
    expect(result.sweep.sourceTxHash).toEqual(expect.any(String));
    // The planned transaction, with the Receiving Address's signature in
    // place and the fee payer's left for the queue.
    const submitted = getTransactionDecoder().decode(
      getBase64Encoder().encode(submission!.transaction),
    );
    const planned = decodePlanned(sweep);
    expect(new Uint8Array(submitted.messageBytes)).toEqual(planned.messageBytes);
    expect(submitted.signatures[address(solana.feePayer)]).toBeNull();
    const ownerSignature = submitted.signatures[address(provider.solanaAddress)];
    expect(ownerSignature).toBeTruthy();
    expect(
      ed25519.verify(
        new Uint8Array(ownerSignature!),
        planned.messageBytes,
        base58.decode(provider.solanaAddress),
      ),
    ).toBe(true);
  });

  test("rejects a signature by another key, and submits nothing", async () => {
    const { solana, sign, complete } = await plannedSolanaSweep("sol-complete-wrong-key.testnet");
    // As if the MPC network had signed for another account or path.
    const nearTxHash = await sign({ key: solanaKeyPair().secretKey });

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed", sourceTxHash: null } });
    expect(result.ok && result.sweep.error).toContain("isn't your Receiving Address's signature");
    expect(solana.submissions).toEqual([]);
  });

  test("rejects a NEAR transaction that signed another message, such as a transfer to someone else", async () => {
    const { solana, sign, complete } = await plannedSolanaSweep("sol-complete-substituted.testnet");
    const other = await plannedSolanaSweep("sol-complete-substituted-other.testnet");
    const otherMessage = Buffer.from(decodePlanned(other.sweep).messageBytes).toString("hex");
    // The Provider's own key, but over a different transfer.
    const nearTxHash = await sign({ payload: `0x${otherMessage}` });

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(solana.submissions).toEqual([]);
  });

  test("a transfer the Solana chain queue refuses fails the Sweep", async () => {
    const { solana, sign, complete } = await plannedSolanaSweep("sol-complete-refused.testnet");
    solana.refuseWith = "Broadcast refused: Blockhash not found";
    const nearTxHash = await sign();

    const result = await complete(nearTxHash);

    expect(result).toMatchObject({
      ok: true,
      sweep: { status: "failed", sourceTxHash: null, submittedAt: null },
    });
    expect(result.ok && result.sweep.error).toContain("Blockhash not found");
  });

  test("an unreachable Solana chain queue leaves the Sweep awaiting its signature, and a refresh submits it", async () => {
    const { sweep, solana, sign, complete, refresh } = await plannedSolanaSweep(
      "sol-complete-unreachable.testnet",
    );
    solana.queueUnreachable = true;
    const nearTxHash = await sign();

    const first = await complete(nearTxHash);
    solana.queueUnreachable = false;
    const refreshed = await refresh();

    expect(first).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(refreshed).toMatchObject({ id: sweep.id, status: "submitted" });
    expect(solana.submissions).toHaveLength(1);
  });

  test("sending the NEAR transaction hash again doesn't submit the Sweep again", async () => {
    const { solana, sign, complete } = await plannedSolanaSweep("sol-complete-twice.testnet");
    const nearTxHash = await sign();

    const first = await complete(nearTxHash);
    const again = await complete(nearTxHash);

    expect(first).toMatchObject({ ok: true, sweep: { status: "submitted" } });
    expect(again).toMatchObject({
      ok: true,
      sweep: { status: "submitted", sourceTxHash: first.ok ? first.sweep.sourceTxHash : null },
    });
    expect(solana.submissions).toHaveLength(1);
  });
});

describe("following a Solana Sweep", () => {
  test("goes from a signature the MPC network is still producing to a confirmed transfer", async () => {
    const { sweep, solana, near, sign, complete, refresh, solanaKey } = await plannedSolanaSweep(
      "sol-refresh-confirmed.testnet",
    );
    const nearTxHash = await sign({ pending: true });

    const completed = await complete(nearTxHash);
    const stillSigning = await refresh();
    const message = Buffer.from(decodePlanned(sweep).messageBytes).toString("hex");
    await near.finish(nearTxHash, `0x${message}`, solanaKey);
    const submitted = await refresh();
    const notLandedYet = await refresh();
    solana.statuses.set(submitted!.sourceTxHash!, "success");
    const confirmed = await refresh();

    expect(completed).toMatchObject({ ok: true, sweep: { status: "awaiting_signature" } });
    expect(stillSigning).toMatchObject({ status: "awaiting_signature" });
    expect(submitted).toMatchObject({ status: "submitted" });
    expect(notLandedYet).toMatchObject({ status: "submitted" });
    expect(confirmed).toMatchObject({
      id: sweep.id,
      status: "confirmed",
      nearTxHash,
      sourceTxHash: submitted!.sourceTxHash,
      sourceTxUrl: `https://explorer.solana.com/tx/${submitted!.sourceTxHash}?cluster=devnet`,
    });
  });

  test("a transfer that failed on Solana fails the Sweep", async () => {
    const { solana, sign, complete, refresh } = await plannedSolanaSweep(
      "sol-refresh-failed.testnet",
    );
    const completed = await complete(await sign());
    if (!completed.ok) throw new Error(completed.message);
    solana.statuses.set(completed.sweep.sourceTxHash!, "failed");

    const refreshed = await refresh();

    expect(refreshed).toMatchObject({ status: "failed" });
    expect(refreshed?.error).toContain("failed on Solana Devnet");
  });

  test("a transfer still missing once its blockhash expired fails the Sweep, and not before", async () => {
    const { sweep, solana, sign, complete, refresh } = await plannedSolanaSweep(
      "sol-refresh-expired.testnet",
    );
    await complete(await sign());

    solana.blockHeight = sweep.lastValidBlockHeight;
    const atLastValidHeight = await refresh();
    solana.blockHeight = sweep.lastValidBlockHeight + 1;
    const pastIt = await refresh();

    expect(atLastValidHeight).toMatchObject({ status: "submitted" });
    expect(pastIt).toMatchObject({ status: "failed" });
    expect(pastIt?.error).toContain("expired");
  });

  test("a Sweep nobody signed fails once its blockhash should have expired", async () => {
    const { provider, sweep, deps } = await plannedSolanaSweep("sol-refresh-unsigned.testnet");

    const [beforeExpiry] = await refreshSweeps(deps, {
      providerId: provider.id,
      env: "testnet",
      now: new Date((sweep.validBefore - 1) * 1000),
    });
    const [afterExpiry] = await refreshSweeps(deps, {
      providerId: provider.id,
      env: "testnet",
      now: new Date(sweep.validBefore * 1000),
    });

    expect(beforeExpiry).toMatchObject({ status: "planned" });
    expect(afterExpiry).toMatchObject({ status: "failed" });
  });

  test("a signature sent in after the Sweep expired is answered with why it failed", async () => {
    const { provider, sweep, deps, sign, complete, solana } = await plannedSolanaSweep(
      "sol-refresh-late-signature.testnet",
    );
    await refreshSweeps(deps, {
      providerId: provider.id,
      env: "testnet",
      now: new Date(sweep.validBefore * 1000),
    });

    const result = await complete(await sign());

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(result.ok && result.sweep.error).toContain("wasn't signed before");
    expect(solana.submissions).toEqual([]);
  });
});

describe("the daily cap", () => {
  test("counts Solana Sweeps with EVM ones: once 10 went out, no more are planned", async () => {
    const context = await solanaProvider("sol-cap.testnet");
    const near = new FakeNear();
    const deps = {
      db: db(),
      readNearTransaction: near.readTransaction,
      submitSweep: new FakeChainQueue().submit,
      readReceipt: fakeReceipts().read,
      readSolana: context.solana.reader,
      solanaQueue: context.solana.queue,
    };
    const planOne = () =>
      planSweep(context.deps, {
        providerId: context.provider.id,
        env: "testnet",
        network: SOLANA_DEVNET,
        amount: "1000",
        destination: context.destination,
      });
    for (let i = 0; i < 10; i++) {
      const { sweep, signRequest } = solanaPlan(await planOne());
      const nearTxHash = await near.sign({
        signerId: context.provider.accountId,
        request: signRequest satisfies MpcSignRequest,
        key: context.solanaKey,
      });
      await completeSweep(deps, {
        providerId: context.provider.id,
        env: "testnet",
        sweepId: sweep.id,
        nearTxHash,
      });
    }

    const eleventh = await planOne();

    expect(context.solana.submissions).toHaveLength(10);
    expect(eleventh).toMatchObject({ ok: false, reason: "daily_cap_reached" });
  });
});
