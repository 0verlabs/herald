import { mpcSigners } from "@herald/core";
import {
  encodeDelegateAction,
  functionCallAction,
  nearDelegatePayloadHash,
  signedNearDelegate,
} from "@herald/core/server";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { FakeNearChain } from "./support/fake-near-chain.ts";
import { installFakeNetwork, NEAR_TESTNET, nearRelayer } from "./support/network.ts";

// The NEAR chain queue's Provider Account creation RPC (#50), as the web
// Worker calls it before a sponsored Sweep's wallet prompt: an implicit
// Provider Account nobody funded has no key on NEAR, so its delegate
// action couldn't land until the relayer creates it.

afterEach(() => {
  vi.restoreAllMocks();
});

const queue = () => env.NEAR_CHAIN_QUEUE.getByName(NEAR_TESTNET);

// What the relayer sends to create an account: 0.002 NEAR, its storage.
const CREATION_YOCTO = 2_000_000_000_000_000_000_000n;

/** A Provider's wallet key and the implicit Provider Account it names, not on NEAR. */
function implicitProvider() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const account = bytesToHex(publicKey);
  return {
    secretKey,
    publicKey,
    account,
    job: { network: NEAR_TESTNET, providerId: 1, account } as const,
  };
}

/** A Durable Object RPC call's answer as a plain Promise (see near-sweep-submissions.test.ts). */
async function plainPromise(call: PromiseLike<unknown>): Promise<unknown> {
  return await call;
}

async function finalHeight(near: FakeNearChain): Promise<number> {
  const answer = (await near.handle({ id: 1, method: "block", params: { finality: "final" } })) as {
    result: { header: { height: number } };
  };
  return answer.result.header.height;
}

/** A sponsored sign from the Provider Account, signed by its wallet key. */
async function walletSignedSign(
  near: FakeNearChain,
  provider: ReturnType<typeof implicitProvider>,
) {
  const height = await finalHeight(near);
  const delegate = encodeDelegateAction({
    senderId: provider.account,
    receiverId: mpcSigners.testnet.contractId,
    actions: [
      functionCallAction({
        methodName: "sign",
        args: {
          request: { payload_v2: { Ecdsa: "ab".repeat(32) }, path: "ethereum-1", domain_id: 0 },
        },
        gas: 50_000_000_000_000n,
        deposit: 1n,
      }),
    ],
    nonce: BigInt(height) * 1_000_000n + 1n,
    maxBlockHeight: BigInt(height + 200),
    publicKey: provider.publicKey,
  });
  const signature = ed25519.sign(nearDelegatePayloadHash(delegate), provider.secretKey);
  return signedNearDelegate(delegate, signature);
}

describe("creating a Provider Account for a sponsored Sweep", () => {
  test("the relayer creates an implicit account that isn't on NEAR, final before it answers, and its wallet's delegate actions can land", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();

    const result = await queue().createProviderAccount(provider.job);

    expect(result).toEqual({ ok: true, transaction: expect.any(String) });
    expect(fake.near.nearTransfers).toEqual([
      {
        txHash: result.ok ? result.transaction : "",
        relayer: nearRelayer().accountId,
        receiver: provider.account,
        amount: CREATION_YOCTO,
        createdAccount: true,
      },
    ]);
    const relayed = await queue().submitSponsoredSign({
      network: NEAR_TESTNET,
      signedDelegateAction: await walletSignedSign(fake.near, provider),
    });
    expect(relayed).toMatchObject({ ok: true });
    expect(fake.near.sponsoredSigns.map((s) => s.sender)).toEqual([provider.account]);
  });

  test("an account already on NEAR is answered without sending anything", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();
    fake.near.addAccount(provider.account, "ed25519:11111111111111111111111111111111", 1n);

    const result = await queue().createProviderAccount(provider.job);

    expect(result).toEqual({ ok: true, transaction: null });
    expect(fake.near.nearTransfers).toEqual([]);
  });

  test("asking again, one after the other or at once, answers the first creation and sends nothing new", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();

    const concurrent = await Promise.all([
      queue().createProviderAccount(provider.job),
      queue().createProviderAccount(provider.job),
      queue().createProviderAccount(provider.job),
    ]);
    const again = await queue().createProviderAccount(provider.job);

    const [first] = concurrent;
    expect(first).toEqual({ ok: true, transaction: expect.any(String) });
    expect([...concurrent, again]).toEqual([first, first, first, first]);
    expect(fake.near.nearTransfers).toHaveLength(1);
  });

  test("a creation not final in time is answered as such, and asking again follows the same transaction", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();
    // Longer than SETTLE_RECEIPT_TIMEOUT_MS (1.5 s in tests).
    fake.near.faults.finalityDelayMs = 2_500;

    const late = await queue().createProviderAccount(provider.job);
    fake.near.faults.finalityDelayMs = 0;
    const again = await queue().createProviderAccount(provider.job);

    expect(late).toMatchObject({ ok: false, message: expect.stringContaining("final") });
    expect(again).toEqual({ ok: true, transaction: fake.near.nearTransfers[0]?.txHash });
    expect(fake.near.nearTransfers).toHaveLength(1);
  });

  test("a lost broadcast is sent again with the same transaction, so the account is created once", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();
    fake.near.faults.failNextBroadcasts = 1;

    const result = await queue().createProviderAccount(provider.job);

    expect(result).toEqual({ ok: true, transaction: expect.any(String) });
    expect(fake.near.nearTransfers).toHaveLength(1);
  });

  test("when NEAR can't be read, it rejects having sent nothing, and asking again creates the account once", async () => {
    const fake = installFakeNetwork();
    const provider = implicitProvider();
    fake.near.faults.failNextRequests = 1;

    await expect(plainPromise(queue().createProviderAccount(provider.job))).rejects.toThrow();
    expect(fake.near.nearTransfers).toEqual([]);

    expect(await queue().createProviderAccount(provider.job)).toMatchObject({ ok: true });
    expect(fake.near.nearTransfers).toHaveLength(1);
  });

  test("refuses a named account, the relayer, another network and a malformed job, sending nothing", async () => {
    const fake = installFakeNetwork();
    const { job } = implicitProvider();

    const results = [
      await queue().createProviderAccount({ ...job, account: "provider.testnet" }),
      await queue().createProviderAccount({ ...job, account: nearRelayer().accountId }),
      await queue().createProviderAccount({ ...job, network: "near:mainnet" }),
      await queue().createProviderAccount({ ...job, providerId: -1 }),
    ];

    expect(results).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false, message: expect.stringContaining("relayer") }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
    ]);
    expect(fake.near.nearTransfers).toEqual([]);
  });
});
