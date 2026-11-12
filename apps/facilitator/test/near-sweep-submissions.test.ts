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

async function finalHeight(near: FakeNearChain): Promise<number> {
  const answer = (await near.handle({ id: 1, method: "block", params: { finality: "final" } })) as {
    result: { header: { height: number } };
  };
  return answer.result.header.height;
}

/**
 * A NEAR Receiving Address holding 5 USDC, set up the way Herald's setup
 * leaves it, and a Sweep from it to a registered account, signed by its key
 * as the MPC network would: the delegate action as core plans it.
 */
async function signedSweep(
  near: FakeNearChain,
  options: { amount?: bigint; blocksLeft?: number; usdc?: string; signer?: Uint8Array } = {},
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
    receiverId: DESTINATION,
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
