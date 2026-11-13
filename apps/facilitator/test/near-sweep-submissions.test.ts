import { networkRegistry } from "@herald/core";
import {
  nearDelegatePayloadHash,
  nearSweepDelegateAction,
  signedNearDelegate,
} from "@herald/core/server";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { FakeNearChain } from "./support/fake-near-chain.ts";
import { installFakeNetwork, NEAR_TESTNET, nearRelayer } from "./support/network.ts";

// The NEAR chain queue's Sweep RPC, as the web Worker calls it through its
// cross-Worker Durable Object binding once the MPC network has signed a
// Provider's delegate action.

afterEach(() => {
  vi.restoreAllMocks();
});

const usdc = networkRegistry.testnet.find((n) => n.caip2 === NEAR_TESTNET)!.usdc.address;
const queue = () => env.NEAR_CHAIN_QUEUE.getByName(NEAR_TESTNET);
const DESTINATION = "alice.testnet";

/**
 * A Durable Object RPC call's answer as a plain Promise. The stub's own
 * promise is a pipelining proxy, which `expect(...).rejects` doesn't see
 * reject.
 */
async function plainPromise(call: PromiseLike<unknown>): Promise<unknown> {
  return await call;
}

async function finalHeight(near: FakeNearChain): Promise<number> {
  const answer = (await near.handle({ id: 1, method: "block", params: { finality: "final" } })) as {
    result: { header: { height: number } };
  };
  return answer.result.header.height;
}

/**
 * A fresh implicit account that doesn't exist and isn't registered on USDC,
 * as 1Click's NEAR deposit addresses are.
 */
function oneClickDepositAddress(): string {
  return bytesToHex(ed25519.getPublicKey(ed25519.utils.randomSecretKey()));
}

/**
 * A NEAR Receiving Address holding 5 USDC, set up the way Herald's setup
 * leaves it, and a Sweep from it, signed by its key as the MPC network
 * would: the delegate action as core plans it. It goes to `DESTINATION`, a
 * registered account, unless `receiver` names another, left as it is.
 */
async function signedSweep(
  near: FakeNearChain,
  options: {
    amount?: bigint;
    blocksLeft?: number;
    usdc?: string;
    signer?: Uint8Array;
    receiver?: string;
  } = {},
) {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const sender = bytesToHex(publicKey);
  const height = await finalHeight(near);
  near.addAccount(sender, `ed25519:${base58.encode(publicKey)}`, 0n);
  near.fundUsdc(sender, 5_000_000n);
  near.registerStorage(DESTINATION);
  const delegate = nearSweepDelegateAction({
    senderId: sender,
    usdc: options.usdc ?? usdc,
    receiverId: options.receiver ?? DESTINATION,
    amount: String(options.amount ?? 1_500_000n),
    nonce: BigInt(height) * 1_000_000n + 1n,
    maxBlockHeight: BigInt(height + (options.blocksLeft ?? 1000)),
    publicKey,
  });
  const signature = ed25519.sign(nearDelegatePayloadHash(delegate), options.signer ?? secretKey);
  return { sender, signedDelegateAction: signedNearDelegate(delegate, signature) };
}

describe("submitting a NEAR Sweep", () => {
  test("the relayer submits the signed delegate action, paying the gas, and the USDC moves", async () => {
    const fake = installFakeNetwork();
    const { sender, signedDelegateAction } = await signedSweep(fake.near);

    const result = await queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction });

    expect(result).toEqual({ ok: true, transaction: expect.any(String) });
    expect(fake.near.transfers).toEqual([
      {
        txHash: result.ok ? result.transaction : "",
        relayer: nearRelayer().accountId,
        relayerNonce: expect.any(BigInt),
        sender,
        receiver: DESTINATION,
        amount: 1_500_000n,
      },
    ]);
    expect(fake.near.usdcBalanceOf(DESTINATION)).toBe(1_500_000n);
    // DESTINATION is registered on USDC already: nothing to register.
    expect(fake.near.storageDeposits).toEqual([]);
  });

  test("a Sweep to an account not registered on USDC, as 1Click's deposit addresses are, is registered by the relayer first and the USDC lands there", async () => {
    const fake = installFakeNetwork();
    const depositAddress = oneClickDepositAddress();
    const { sender, signedDelegateAction } = await signedSweep(fake.near, {
      receiver: depositAddress,
    });

    const result = await queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction });

    expect(result).toEqual({ ok: true, transaction: expect.any(String) });
    expect(fake.near.storageDeposits).toEqual([
      {
        txHash: expect.any(String),
        relayer: nearRelayer().accountId,
        account: depositAddress,
        deposit: 1_250_000_000_000_000_000_000n,
      },
    ]);
    expect(fake.near.transfers).toEqual([
      expect.objectContaining({ sender, receiver: depositAddress, amount: 1_500_000n }),
    ]);
    expect(fake.near.usdcBalanceOf(depositAddress)).toBe(1_500_000n);
  });

  test.each([
    {
      case: "reading whether it is registered fails",
      fault: { failNextCalls: { storage_balance_of: 1 } },
    },
    {
      case: "the registration isn't final in time",
      fault: { finalityDelayMs: 60_000 },
    },
  ])(
    "when $case, the submission rejects without moving USDC, and submitting again registers it once and lands once",
    async ({ fault }) => {
      const fake = installFakeNetwork();
      const depositAddress = oneClickDepositAddress();
      const { signedDelegateAction } = await signedSweep(fake.near, { receiver: depositAddress });
      const submission = { network: NEAR_TESTNET as typeof NEAR_TESTNET, signedDelegateAction };
      Object.assign(fake.near.faults, fault);

      await expect(plainPromise(queue().submitSweep(submission))).rejects.toThrow();
      expect(fake.near.transfers).toEqual([]);

      Object.assign(fake.near.faults, { failNextCalls: {}, finalityDelayMs: 0 });
      const again = await queue().submitSweep(submission);

      expect(again).toEqual({ ok: true, transaction: expect.any(String) });
      expect(fake.near.storageDeposits.map((d) => d.account)).toEqual([depositAddress]);
      expect(fake.near.transfers).toHaveLength(1);
      expect(fake.near.usdcBalanceOf(depositAddress)).toBe(1_500_000n);
    },
  );

  test("refuses a Sweep that comes within a few blocks of expiring while its receiver is registered, and moves no USDC", async () => {
    const fake = installFakeNetwork();
    const depositAddress = oneClickDepositAddress();
    // Past the expiry check at first; the registration's own block reads
    // bring NEAR within the margin before the delegate action is sent.
    const { signedDelegateAction } = await signedSweep(fake.near, {
      receiver: depositAddress,
      blocksLeft: 12,
    });

    const result = await queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("expired") });
    expect(fake.near.storageDeposits.map((d) => d.account)).toEqual([depositAddress]);
    expect(fake.near.transfers).toEqual([]);
  });

  test("presenting the same Sweep again, one after the other or at once, answers the first transaction and sends nothing new", async () => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSweep(fake.near);
    const submission = { network: NEAR_TESTNET as typeof NEAR_TESTNET, signedDelegateAction };

    const first = await queue().submitSweep(submission);
    const again = await queue().submitSweep(submission);
    const concurrent = await Promise.all([
      queue().submitSweep(submission),
      queue().submitSweep(submission),
    ]);

    expect(first.ok).toBe(true);
    expect([again, ...concurrent]).toEqual([first, first, first]);
    expect(fake.near.transfers).toHaveLength(1);
  });

  test("two Sweeps submitted at once both land, on consecutive relayer nonces", async () => {
    const fake = installFakeNetwork();
    const one = await signedSweep(fake.near);
    const two = await signedSweep(fake.near);

    const results = await Promise.all(
      [one, two].map(({ signedDelegateAction }) =>
        queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction }),
      ),
    );

    expect(results.map((r) => r.ok)).toEqual([true, true]);
    const nonces = fake.near.transfers
      .map((t) => t.relayerNonce)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(nonces).toHaveLength(2);
    expect(nonces[1]! - nonces[0]!).toBe(1n);
  });

  test("refuses a delegate action that expired, without sending anything", async () => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSweep(fake.near, { blocksLeft: 0 });

    const result = await queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("expired") });
    expect(fake.near.transfers).toEqual([]);
  });

  test.each([
    { case: "signed by another key", options: { signer: ed25519.utils.randomSecretKey() } },
    { case: "a transfer of another token", options: { usdc: "wrap.testnet" } },
  ])("refuses a delegate action $case, without sending anything", async ({ options }) => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSweep(fake.near, options);

    const result = await queue().submitSweep({ network: NEAR_TESTNET, signedDelegateAction });

    expect(result).toMatchObject({ ok: false });
    expect(fake.near.transfers).toEqual([]);
  });

  test("refuses a Sweep for a network the queue isn't for, and one that isn't a delegate action", async () => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSweep(fake.near);

    const otherNetwork = await queue().submitSweep({
      network: "near:mainnet",
      signedDelegateAction,
    });
    const garbage = await queue().submitSweep({
      network: NEAR_TESTNET,
      signedDelegateAction: "bm90IGEgZGVsZWdhdGU=",
    });

    expect(otherNetwork).toMatchObject({ ok: false });
    expect(garbage).toMatchObject({ ok: false });
    expect(fake.near.transfers).toEqual([]);
  });
});
