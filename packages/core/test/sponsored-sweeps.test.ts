import { createDb } from "@herald/db";
import { sweeps } from "@herald/db/schema";
import { base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { receivingAddressPaths, type HeraldEnv } from "../src/index.ts";
import {
  completeSweep,
  planSweep,
  prepareSponsoredSweepAccount,
  refreshSweeps,
  relaySponsoredSweep,
  SPONSORED_SIGN_MAX_GAS,
  SWEEP_DAILY_CAP,
  type MpcSignRequest,
  type SweepDeps,
  type SweepTarget,
} from "../src/server/index.ts";
import { implicitAccountOf, nearKey } from "./support/near.ts";
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
  usdcBalances,
  walletSignedSign,
} from "./support/sweeps.ts";

// A sponsored Sweep (ADR 0010): the Provider's wallet signs a NEP-366
// delegate action holding the Sweep's MPC `sign` call instead of sending
// it, and Herald's NEAR relayer sends it, paying the gas. Herald reads the
// signature from the relayer's transaction and submits the transfer as for
// any Sweep.

const db = () => createDb(env.DB);

const BASE_SEPOLIA = "eip155:84532";
const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const NEAR_TESTNET = "near:testnet";
const BASE = "eip155:8453";
const DESTINATION = "0x000000000000000000000000000000000000d00d";
const NEAR_DESTINATION = "alice.testnet";

/**
 * A Provider holding 5 USDC on every chain, its NEAR wallet's key, and
 * fakes for everything outside Herald: the chains, the chain queues, 1Click,
 * and NEAR with the MPC signer, which signs `sign` calls from the Provider
 * Account with the Receiving Addresses' keys. Herald's relayer relays
 * sponsored signs into that NEAR.
 */
async function sponsoredProvider(
  accountId: string,
  heraldEnv: HeraldEnv = "testnet",
  wallet = nearKey(),
) {
  const context = await sweepingProvider(accountId);
  const { provider } = context;
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
    readUsdcBalance: usdcBalances({
      [provider.evmAddress]: "5000000",
      [provider.solanaAddress]: "5000000",
      [provider.nearAddress]: "5000000",
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
  const base = { providerId: provider.id, env: heraldEnv };

  /** Plans a Sweep, of 1.5 USDC from Base Sepolia to `DESTINATION` unless told otherwise. */
  const plan = async (
    target: { network?: string; amount?: string; now?: Date } & Partial<SweepTarget> = {},
  ): Promise<{ sweepId: number; signRequest: MpcSignRequest }> => {
    const planned = await planSweep(planDeps, {
      ...base,
      network: BASE_SEPOLIA,
      amount: "1500000",
      destination: DESTINATION,
      ...target,
    } as Parameters<typeof planSweep>[1]);
    if (!planned.ok) throw new Error(planned.message);
    return { sweepId: planned.sweep.id, signRequest: planned.signRequest };
  };
  /** The wallet's signed delegate action holding `request`'s `sign` call. */
  const signDelegate = (
    request: MpcSignRequest,
    options: Omit<Parameters<typeof walletSignedSign>[0], "accountId" | "key" | "request"> = {},
  ) => walletSignedSign({ accountId, key: wallet, request, ...options });
  const relay = (sweepId: number, signedDelegateAction: string, now?: Date) =>
    relaySponsoredSweep(deps, { ...base, sweepId, signedDelegateAction, now });
  /** Has Herald make sure the Provider Account is on NEAR before the wallet signs (#50). */
  const prepare = (sweepId: number, now?: Date) =>
    prepareSponsoredSweepAccount(
      { db: db(), nearQueue: { createProviderAccount: near.createAccount } },
      { ...base, sweepId, now },
    );
  const sweepRow = async (sweepId: number) =>
    (await db().select().from(sweeps).where(eq(sweeps.id, sweepId)))[0];
  return {
    ...context,
    wallet,
    near,
    chain,
    solana,
    solanaDestination,
    nearUsdc,
    deps,
    base,
    plan,
    signDelegate,
    relay,
    prepare,
    sweepRow,
  };
}

describe("a sponsored Sweep", () => {
  test("Herald's relayer sends the wallet's signed delegate action, and the Sweep reads the signature from the relayer's transaction and submits the transfer", async () => {
    const { near, chain, plan, signDelegate, relay } =
      await sponsoredProvider("sponsored-evm.testnet");
    const { sweepId, signRequest } = await plan();
    const signedDelegateAction = await signDelegate(signRequest);

    const result = await relay(sweepId, signedDelegateAction);

    if (!result.ok) throw new Error(result.message);
    expect(near.sponsoredSubmissions).toEqual([{ network: NEAR_TESTNET, signedDelegateAction }]);
    expect(result.sweep).toMatchObject({
      status: "submitted",
      nearTxHash: expect.any(String),
      nearTxRelayer: near.relayer,
      error: null,
    });
    expect(chain.submissions).toHaveLength(1);
  });

  test("from Solana, the signed transfer goes to the Solana chain queue", async () => {
    const { solana, solanaDestination, plan, signDelegate, relay } = await sponsoredProvider(
      "sponsored-solana.testnet",
    );
    const { sweepId, signRequest } = await plan({
      network: SOLANA_DEVNET,
      destination: solanaDestination,
    });

    const result = await relay(sweepId, await signDelegate(signRequest));

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep.status).toBe("submitted");
    expect(solana.submissions).toHaveLength(1);
  });

  test("from NEAR, the signed USDC transfer goes to the NEAR chain queue", async () => {
    const { nearUsdc, plan, signDelegate, relay } =
      await sponsoredProvider("sponsored-near.testnet");
    const { sweepId, signRequest } = await plan({
      network: NEAR_TESTNET,
      destination: NEAR_DESTINATION,
    });

    const result = await relay(sweepId, await signDelegate(signRequest));

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep.status).toBe("submitted");
    expect(nearUsdc.submissions).toHaveLength(1);
  });

  test("a 1Click Sweep on mainnet is relayed to the mainnet MPC signer, and its transfer goes to 1Click's deposit address", async () => {
    const { near, chain, plan, signDelegate, relay } = await sponsoredProvider(
      "sponsored-intents.near",
      "mainnet",
    );
    const { sweepId, signRequest } = await plan({ network: BASE, destinationKind: "intents" });
    expect(signRequest.contractId).toBe("v1.signer");

    const result = await relay(sweepId, await signDelegate(signRequest));

    if (!result.ok) throw new Error(result.message);
    expect(near.sponsoredSubmissions.map((s) => s.network)).toEqual(["near:mainnet"]);
    expect(result.sweep).toMatchObject({ status: "submitted", nearTxRelayer: near.relayer });
    expect(chain.submissions).toHaveLength(1);
  });

  test("waits while the MPC network is still signing, and a refresh submits it once the signature is in the relayer's transaction", async () => {
    const context = await sponsoredProvider("sponsored-pending.testnet");
    const { near, chain, plan, signDelegate, relay } = context;
    near.pendingRelayedSigns = true;
    const { sweepId, signRequest } = await plan();

    const first = await relay(sweepId, await signDelegate(signRequest));
    if (!first.ok) throw new Error(first.message);
    expect(first.sweep.status).toBe("awaiting_signature");
    expect(chain.submissions).toEqual([]);

    const payload =
      "Ecdsa" in signRequest.args.request.payload_v2
        ? signRequest.args.request.payload_v2.Ecdsa
        : "";
    await near.finish(first.sweep.nearTxHash!, `0x${payload}`, context.receivingKey);
    const [refreshed] = await refreshSweeps(context.deps, context.base);

    expect(refreshed).toMatchObject({ id: sweepId, status: "submitted" });
    expect(chain.submissions).toHaveLength(1);
  });

  test("a relayed delegate action that failed on NEAR, as one with a used nonce does, fails the Sweep and submits nothing", async () => {
    const { near, chain, plan, signDelegate, relay } =
      await sponsoredProvider("sponsored-nonce.testnet");
    near.failRelayedDelegateWith = { DelegateActionInvalidNonce: { delegate_nonce: 1 } };
    const { sweepId, signRequest } = await plan();

    const result = await relay(sweepId, await signDelegate(signRequest));

    if (!result.ok) throw new Error(result.message);
    expect(result.sweep.status).toBe("failed");
    expect(result.sweep.error).toContain("didn't sign");
    expect(chain.submissions).toEqual([]);
  });
});

describe("what Herald relays", () => {
  test.each([
    { case: "is from another account", id: "sender", reason: "from other.testnet" },
    { case: "calls another contract than the MPC signer", id: "receiver", reason: "evil.testnet" },
    { case: "calls another method", id: "method", reason: "not sign" },
    { case: "holds a second action", id: "extra", reason: "not exactly one sign call" },
    { case: "attaches 2 yoctoNEAR", id: "deposit", reason: "not exactly 1" },
    { case: "asks for more gas than the cap", id: "gas", reason: "gas" },
    {
      case: "asks to sign another Sweep's payload",
      id: "payload",
      reason: "payload, path or domain",
    },
    { case: "asks for another derivation path", id: "path", reason: "payload, path or domain" },
    { case: "asks for another domain", id: "domain", reason: "payload, path or domain" },
    { case: "carries a signature that isn't its key's", id: "signature", reason: "signature" },
    { case: "isn't a delegate action at all", id: "garbage", reason: "isn't a signed delegate" },
  ])(
    "refuses a delegate action that $case, relays nothing and leaves the Sweep planned",
    async ({ id, reason }) => {
      const context = await sponsoredProvider(`sponsored-refuse-${id}.testnet`);
      const { near, plan, signDelegate, relay, sweepRow } = context;
      const { sweepId, signRequest } = await plan();
      const other = await plan({ destination: "0x000000000000000000000000000000000000beef" });
      const request = signRequest.args.request;
      const signed = {
        sender: () =>
          walletSignedSign({
            accountId: "other.testnet",
            key: context.wallet,
            request: signRequest,
          }),
        receiver: () => signDelegate(signRequest, { change: { receiverId: "evil.testnet" } }),
        method: () => signDelegate(signRequest, { change: { methodName: "sign_v2" } }),
        extra: () => signDelegate(signRequest, { change: { extraAction: true } }),
        deposit: () => signDelegate(signRequest, { change: { deposit: 2n } }),
        gas: () => signDelegate(signRequest, { change: { gas: SPONSORED_SIGN_MAX_GAS + 1n } }),
        payload: () => signDelegate(other.signRequest),
        path: () =>
          signDelegate(signRequest, {
            change: { args: { request: { ...request, path: "ethereum-2" } } },
          }),
        domain: () =>
          signDelegate(signRequest, {
            change: { args: { request: { ...request, domain_id: 1 } } },
          }),
        signature: async () => {
          const bytes = base64.decode(await signDelegate(signRequest));
          bytes[bytes.length - 1]! ^= 0xff;
          return base64.encode(bytes);
        },
        garbage: async () => base64.encode(new TextEncoder().encode("not a delegate")),
      }[id]!;

      const result = await relay(sweepId, await signed());

      expect(result).toMatchObject({ ok: false, reason: "delegate_refused" });
      expect(!result.ok && result.message).toContain(reason);
      expect(near.sponsoredSubmissions).toEqual([]);
      expect(await sweepRow(sweepId)).toMatchObject({ status: "planned", nearTxHash: null });
    },
  );

  test("accepts a wallet attaching a little more gas than Herald asked for, up to the cap", async () => {
    const { plan, signDelegate, relay } = await sponsoredProvider("sponsored-gas.testnet");
    const { sweepId, signRequest } = await plan();

    const result = await relay(
      sweepId,
      await signDelegate(signRequest, { change: { gas: SPONSORED_SIGN_MAX_GAS } }),
    );

    expect(result).toMatchObject({ ok: true, sweep: { status: "submitted" } });
  });

  test("the relayer's own refusal leaves the Sweep planned, and says why", async () => {
    const { near, plan, signDelegate, relay, sweepRow } = await sponsoredProvider(
      "sponsored-relayer-refuses.testnet",
    );
    near.refuseSponsoredWith = "The Provider Account has no such full-access key on NEAR";
    const { sweepId, signRequest } = await plan();

    const result = await relay(sweepId, await signDelegate(signRequest));

    expect(result).toMatchObject({ ok: false, reason: "relay_refused" });
    expect(!result.ok && result.message).toContain("no such full-access key");
    expect(await sweepRow(sweepId)).toMatchObject({ status: "planned", nearTxHash: null });
  });

  test("an unreachable relayer leaves the Sweep planned, and presenting the same delegate action again relays it", async () => {
    const { near, chain, plan, signDelegate, relay } = await sponsoredProvider(
      "sponsored-unreachable.testnet",
    );
    const { sweepId, signRequest } = await plan();
    const signedDelegateAction = await signDelegate(signRequest);
    near.relayUnreachable = true;

    const first = await relay(sweepId, signedDelegateAction);
    near.relayUnreachable = false;
    const again = await relay(sweepId, signedDelegateAction);

    expect(first).toMatchObject({ ok: false, reason: "relay_unanswered" });
    expect(again).toMatchObject({ ok: true, sweep: { status: "submitted" } });
    expect(chain.submissions).toHaveLength(1);
  });
});

describe("relaying once", () => {
  test("presenting the same signed delegate action again answers the Sweep with its relayer transaction, and relays and submits nothing new", async () => {
    const { near, chain, plan, signDelegate, relay } =
      await sponsoredProvider("sponsored-twice.testnet");
    const { sweepId, signRequest } = await plan();
    const signedDelegateAction = await signDelegate(signRequest);

    const first = await relay(sweepId, signedDelegateAction);
    const again = await relay(sweepId, signedDelegateAction);

    if (!first.ok || !again.ok) throw new Error("Expected both to answer the Sweep");
    expect(again.sweep).toMatchObject({
      id: sweepId,
      status: "submitted",
      nearTxHash: first.sweep.nearTxHash,
    });
    expect(near.sponsoredSubmissions).toHaveLength(1);
    expect(chain.submissions).toHaveLength(1);
  });

  test("a second delegate action for a Sweep already relayed isn't relayed", async () => {
    const { near, plan, signDelegate, relay } = await sponsoredProvider("sponsored-second.testnet");
    const { sweepId, signRequest } = await plan();
    const first = await relay(sweepId, await signDelegate(signRequest, { nonce: 1_000_001n }));

    const second = await relay(sweepId, await signDelegate(signRequest, { nonce: 1_000_002n }));

    if (!first.ok || !second.ok) throw new Error("Expected both to answer the Sweep");
    expect(second.sweep.nearTxHash).toBe(first.sweep.nearTxHash);
    expect(near.sponsoredSubmissions).toHaveLength(1);
  });

  test("a Sweep the Provider's wallet already signed and paid for isn't relayed", async () => {
    const context = await sponsoredProvider("sponsored-after-wallet.testnet");
    const { near, plan, signDelegate, relay } = context;
    const { sweepId, signRequest } = await plan();
    const nearTxHash = await near.sign({
      signerId: context.provider.accountId,
      request: signRequest,
      key: context.receivingKey,
    });
    await completeSweep(context.deps, { ...context.base, sweepId, nearTxHash });

    const result = await relay(sweepId, await signDelegate(signRequest));

    expect(result).toMatchObject({ ok: false, reason: "near_tx_mismatch" });
    expect(near.sponsoredSubmissions).toEqual([]);
  });

  test("a sponsored Sweep can't be handed another NEAR transaction afterwards", async () => {
    const context = await sponsoredProvider("sponsored-then-wallet.testnet");
    const { near, plan, signDelegate, relay } = context;
    const { sweepId, signRequest } = await plan();
    const relayed = await relay(sweepId, await signDelegate(signRequest));
    if (!relayed.ok) throw new Error(relayed.message);
    const walletTx = await near.sign({
      signerId: context.provider.accountId,
      request: signRequest,
      key: context.receivingKey,
    });

    const result = await completeSweep(context.deps, {
      ...context.base,
      sweepId,
      nearTxHash: walletTx,
    });

    expect(result).toMatchObject({ ok: false, reason: "near_tx_mismatch" });
  });

  test("a Sweep whose signing window passed fails rather than being relayed", async () => {
    const { near, plan, signDelegate, relay } = await sponsoredProvider(
      "sponsored-expired.testnet",
    );
    const { sweepId, signRequest } = await plan();

    const result = await relay(
      sweepId,
      await signDelegate(signRequest),
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(result).toMatchObject({ ok: true, sweep: { status: "failed" } });
    expect(near.sponsoredSubmissions).toEqual([]);
  });
});

describe("the daily cap", () => {
  test("sponsored Sweeps count against it: past the cap, Herald plans no more", async () => {
    const context = await sponsoredProvider("sponsored-cap.testnet");
    const { plan, signDelegate, relay } = context;
    for (let i = 0; i < SWEEP_DAILY_CAP; i++) {
      const { sweepId, signRequest } = await plan();
      const relayed = await relay(sweepId, await signDelegate(signRequest));
      expect(relayed).toMatchObject({ ok: true, sweep: { status: "submitted" } });
    }

    await expect(plan()).rejects.toThrow("at most 10 Sweeps");
  });

  test("Herald relays no more signs than the cap leaves room for, counting those still awaiting their signature", async () => {
    const { near, plan, signDelegate, relay, sweepRow } = await sponsoredProvider(
      "sponsored-cap-in-flight.testnet",
    );
    near.pendingRelayedSigns = true;
    const planned = [];
    for (let i = 0; i <= SWEEP_DAILY_CAP; i++) planned.push(await plan());
    const [last, ...first] = planned.reverse();
    for (const { sweepId, signRequest } of first) {
      expect(await relay(sweepId, await signDelegate(signRequest))).toMatchObject({ ok: true });
    }

    const over = await relay(last!.sweepId, await signDelegate(last!.signRequest));

    expect(over).toMatchObject({ ok: false, reason: "daily_cap_reached" });
    expect(near.sponsoredSubmissions).toHaveLength(SWEEP_DAILY_CAP);
    expect(await sweepRow(last!.sweepId)).toMatchObject({ status: "planned" });
  });
});

// An implicit Provider Account nobody funded has no key on NEAR, so its
// wallet's delegate action can't land. Before the wallet signs a sponsored
// Sweep, Herald creates it from the relayer (#50).
describe("preparing the Provider Account for a sponsored Sweep", () => {
  /** A Provider signed in with an implicit account, its wallet key's, that isn't on NEAR. */
  async function implicitProvider() {
    const wallet = nearKey();
    return sponsoredProvider(implicitAccountOf(wallet), "testnet", wallet);
  }

  test("Herald creates an implicit Provider Account that isn't on NEAR, then the Sweep goes through", async () => {
    const { provider, near, chain, plan, prepare, signDelegate, relay } = await implicitProvider();
    const { sweepId, signRequest } = await plan();

    const prepared = await prepare(sweepId);
    const relayed = await relay(sweepId, await signDelegate(signRequest));

    expect(prepared).toEqual({ ok: true, transaction: expect.any(String) });
    expect(near.accountJobs).toEqual([
      { network: NEAR_TESTNET, providerId: provider.id, account: provider.accountId },
    ]);
    expect(relayed).toMatchObject({ ok: true, sweep: { status: "submitted" } });
    expect(chain.submissions).toHaveLength(1);
  });

  test("a named Provider Account is never created: named accounts exist before anyone signs in", async () => {
    const { near, plan, prepare } = await sponsoredProvider("sponsored-named.testnet");
    const { sweepId } = await plan();

    expect(await prepare(sweepId)).toEqual({ ok: true, transaction: null });
    expect(near.accountJobs).toEqual([]);
  });

  test("an implicit Provider Account already on NEAR isn't created", async () => {
    const { provider, near, plan, prepare } = await implicitProvider();
    near.existing.add(provider.accountId);
    const { sweepId } = await plan();

    expect(await prepare(sweepId)).toEqual({ ok: true, transaction: null });
    expect(near.createdAccounts.size).toBe(0);
  });

  test("once Herald created it, later Sweeps don't ask for it again", async () => {
    const { provider, near, plan, prepare, signDelegate, relay } = await implicitProvider();
    const first = await plan();
    await prepare(first.sweepId);
    await relay(first.sweepId, await signDelegate(first.signRequest));
    const second = await plan();

    const again = await prepare(second.sweepId);

    expect(again).toEqual({ ok: true, transaction: near.createdAccounts.get(provider.accountId) });
    expect(near.accountJobs).toHaveLength(1);
  });

  test("preparing the same Sweep again, or two at once, never creates the account twice", async () => {
    const { near, plan, prepare } = await implicitProvider();
    const one = await plan();
    const other = await plan();

    const results = await Promise.all([prepare(one.sweepId), prepare(other.sweepId)]);
    const retried = await prepare(one.sweepId);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(retried).toMatchObject({ ok: true });
    expect(near.createdAccounts.size).toBe(1);
  });

  test("nothing is created for a Sweep that isn't the Provider's, or doesn't exist", async () => {
    const { near, prepare } = await implicitProvider();
    const someoneElse = await sponsoredProvider("sponsored-other.testnet");
    const { sweepId } = await someoneElse.plan();

    expect(await prepare(sweepId)).toMatchObject({ ok: false, reason: "unknown_sweep" });
    expect(await prepare(999_999)).toMatchObject({ ok: false, reason: "unknown_sweep" });
    expect(near.accountJobs).toEqual([]);
  });

  test("nothing is created without a planned Sweep: a withdrawal below the minimum isn't planned", async () => {
    const { near, plan } = await implicitProvider();

    await expect(plan({ amount: "1" })).rejects.toThrow("minimum");
    expect(near.accountJobs).toEqual([]);
  });

  test("nothing is created for a Sweep already relayed, or past its signing window", async () => {
    const { near, plan, prepare, signDelegate, relay } = await implicitProvider();
    const relayed = await plan();
    await relay(relayed.sweepId, await signDelegate(relayed.signRequest));
    const late = await plan();

    const results = [
      await prepare(relayed.sweepId),
      await prepare(late.sweepId, new Date(Date.now() + 60 * 60 * 1000)),
    ];

    expect(results).toEqual([
      expect.objectContaining({ ok: false, reason: "sweep_not_signable" }),
      expect.objectContaining({ ok: false, reason: "sweep_not_signable" }),
    ]);
    expect(near.accountJobs).toEqual([]);
  });

  test("nothing is created when the daily cap leaves no room for the Sweep", async () => {
    const { near, plan, prepare, signDelegate, relay } = await implicitProvider();
    near.pendingRelayedSigns = true;
    const planned = [];
    for (let i = 0; i <= SWEEP_DAILY_CAP; i++) planned.push(await plan());
    const [last, ...first] = planned.reverse();
    for (const { sweepId, signRequest } of first)
      await relay(sweepId, await signDelegate(signRequest));

    expect(await prepare(last!.sweepId)).toMatchObject({ ok: false, reason: "daily_cap_reached" });
    expect(near.accountJobs).toEqual([]);
  });

  test("a creation that failed or wasn't final in time says so, leaves the Sweep planned, and can be tried again", async () => {
    const { near, plan, prepare, sweepRow } = await implicitProvider();
    const { sweepId } = await plan();
    near.refuseAccountWith = "The transaction creating it wasn't final within 30000 ms";

    const refused = await prepare(sweepId);
    near.refuseAccountWith = null;
    const again = await prepare(sweepId);

    expect(refused).toMatchObject({
      ok: false,
      reason: "account_refused",
      message: expect.stringContaining("wasn't final"),
    });
    expect(again).toEqual({ ok: true, transaction: expect.any(String) });
    expect((await sweepRow(sweepId))?.status).toBe("planned");
  });

  test("an unreachable chain queue says so, and asking again creates the account", async () => {
    const { near, plan, prepare } = await implicitProvider();
    const { sweepId } = await plan();
    near.accountUnreachable = true;

    const unanswered = await prepare(sweepId);
    near.accountUnreachable = false;
    const again = await prepare(sweepId);

    expect(unanswered).toMatchObject({ ok: false, reason: "account_unanswered" });
    expect(again).toEqual({ ok: true, transaction: expect.any(String) });
    expect(near.createdAccounts.size).toBe(1);
  });
});
