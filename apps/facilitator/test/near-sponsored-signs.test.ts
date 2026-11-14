import { mpcSigners, networkRegistry } from "@herald/core";
import {
  encodeDelegateAction,
  functionCallAction,
  nearDelegatePayloadHash,
  nearSweepDelegateAction,
  signedNearDelegate,
  SPONSORED_SIGN_MAX_GAS,
} from "@herald/core/server";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { FakeNearChain, NearChainFaults } from "./support/fake-near-chain.ts";
import { installFakeNetwork, NEAR_TESTNET, nearRelayer } from "./support/network.ts";

// The NEAR chain queue's sponsored-sign RPC (ADR 0010), as the web Worker
// calls it through its cross-Worker Durable Object binding with the
// delegate action a Provider's wallet signed: one MPC `sign` call, which
// Herald's relayer sends and pays for.

afterEach(() => {
  vi.restoreAllMocks();
});

const MPC = mpcSigners.testnet.contractId;
const usdc = networkRegistry.testnet.find((n) => n.caip2 === NEAR_TESTNET)!.usdc.address;
const queue = () => env.NEAR_CHAIN_QUEUE.getByName(NEAR_TESTNET);
const PROVIDER = "provider.testnet";

const signRequest = {
  request: { payload_v2: { Ecdsa: "ab".repeat(32) }, path: "ethereum-1", domain_id: 0 },
};

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

type SignOptions = {
  sender?: string;
  receiverId?: string;
  methodName?: string;
  deposit?: bigint;
  gas?: bigint;
  extraAction?: boolean;
  blocksLeft?: number;
  /** The delegate action's nonce, or the key's own nonce on chain, already used. */
  nonce?: bigint | "key's";
  /** Sign with another key than the one the delegate action names. */
  signer?: Uint8Array;
  /** The sender doesn't have the key on chain at all, as an unfunded implicit account. */
  keyOnChain?: "full" | "function_call" | "none";
};

/**
 * A Provider Account with a full-access key on NEAR, and a delegate action
 * from it holding one MPC `sign` call, signed by that key as its wallet
 * would. `options` change what it signs.
 */
async function signedSign(near: FakeNearChain, options: SignOptions = {}) {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  const sender = options.sender ?? PROVIDER;
  const keyString = `ed25519:${base58.encode(publicKey)}`;
  const height = await finalHeight(near);
  const keyOnChain = options.keyOnChain ?? "full";
  if (keyOnChain === "full") near.addAccount(sender, keyString, 0n);
  if (keyOnChain === "function_call") {
    near.addAccount(
      sender,
      `ed25519:${base58.encode(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))}`,
      0n,
    );
    near.addAccessKey(sender, keyString, {
      FunctionCall: { allowance: null, receiver_id: MPC, method_names: ["sign"] },
    });
  }
  const sign = functionCallAction({
    methodName: options.methodName ?? "sign",
    args: signRequest,
    gas: options.gas ?? 50_000_000_000_000n,
    deposit: options.deposit ?? 1n,
  });
  // A key added now starts at the height × 10^6, as on NEAR.
  const keyNonce = BigInt(height) * 1_000_000n;
  const delegate = encodeDelegateAction({
    senderId: sender,
    receiverId: options.receiverId ?? MPC,
    actions: options.extraAction ? [sign, sign] : [sign],
    nonce: options.nonce === "key's" ? keyNonce : (options.nonce ?? keyNonce + 1n),
    maxBlockHeight: BigInt(height + (options.blocksLeft ?? 200)),
    publicKey,
  });
  const signature = ed25519.sign(nearDelegatePayloadHash(delegate), options.signer ?? secretKey);
  return { sender, signedDelegateAction: signedNearDelegate(delegate, signature) };
}

describe("relaying a sponsored sign", () => {
  test("the relayer sends the Provider Account's sign call to the MPC signer and pays for it all, deposit included", async () => {
    const fake = installFakeNetwork();
    const { sender, signedDelegateAction } = await signedSign(fake.near);
    const relayerBefore = fake.near.nearBalanceOf(nearRelayer().accountId);

    const result = await queue().submitSponsoredSign({
      network: NEAR_TESTNET,
      signedDelegateAction,
    });

    expect(result).toEqual({
      ok: true,
      transaction: expect.any(String),
      relayer: nearRelayer().accountId,
    });
    expect(fake.near.sponsoredSigns).toEqual([
      {
        txHash: result.ok ? result.transaction : "",
        relayer: nearRelayer().accountId,
        sender,
        request: signRequest.request,
        gas: 50_000_000_000_000n,
        deposit: 1n,
      },
    ]);
    expect(fake.near.nearBalanceOf(sender)).toBe(0n);
    expect(fake.near.nearBalanceOf(nearRelayer().accountId)).toBe(relayerBefore - 1n);
  });

  test("presenting the same signed delegate action again, one after the other or at once, answers the first transaction and sends nothing new", async () => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSign(fake.near);
    const submission = { network: NEAR_TESTNET as typeof NEAR_TESTNET, signedDelegateAction };

    const first = await queue().submitSponsoredSign(submission);
    const again = await queue().submitSponsoredSign(submission);
    const concurrent = await Promise.all([
      queue().submitSponsoredSign(submission),
      queue().submitSponsoredSign(submission),
    ]);

    expect(first.ok).toBe(true);
    expect([again, ...concurrent]).toEqual([first, first, first]);
    expect(fake.near.sponsoredSigns).toHaveLength(1);
  });

  test.each<{ case: string; options: SignOptions; reason: string }>([
    {
      case: "calls another contract",
      options: { receiverId: "evil.testnet" },
      reason: "MPC signer",
    },
    { case: "calls another method", options: { methodName: "sign_v2" }, reason: "not sign" },
    { case: "holds two sign calls", options: { extraAction: true }, reason: "not exactly one" },
    { case: "attaches no deposit", options: { deposit: 0n }, reason: "not exactly 1" },
    { case: "attaches 2 yoctoNEAR", options: { deposit: 2n }, reason: "not exactly 1" },
    {
      case: "asks for more gas than the cap",
      options: { gas: SPONSORED_SIGN_MAX_GAS + 1n },
      reason: "gas",
    },
    {
      case: "is signed by another key than it names",
      options: { signer: ed25519.utils.randomSecretKey() },
      reason: "signature",
    },
    { case: "expired", options: { blocksLeft: 0 }, reason: "expired" },
    {
      case: "is a few blocks from its max_block_height, too close to land",
      options: { blocksLeft: 5 },
      reason: "expired",
    },
    {
      case: "is from an account without that key on NEAR, as an unfunded implicit account",
      options: { keyOnChain: "none" },
      reason: "no access key",
    },
    {
      case: "is signed by a function-call key, which can't attach the deposit",
      options: { keyOnChain: "function_call" },
      reason: "full-access",
    },
    { case: "has a nonce the key already used", options: { nonce: 1n }, reason: "nonce" },
    { case: "has the key's own nonce", options: { nonce: "key's" }, reason: "is used" },
  ])("refuses a delegate action that $case, sending nothing", async ({ options, reason }) => {
    const fake = installFakeNetwork();
    const { signedDelegateAction } = await signedSign(fake.near, options);

    const result = await queue().submitSponsoredSign({
      network: NEAR_TESTNET,
      signedDelegateAction,
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(reason) });
    expect(fake.near.sponsoredSigns).toEqual([]);
  });

  test("refuses a sign from the relayer itself, one for a network the queue isn't for, and one that isn't a delegate action", async () => {
    const fake = installFakeNetwork();
    const fromRelayer = await signedSign(fake.near, { sender: nearRelayer().accountId });
    const { signedDelegateAction } = await signedSign(fake.near);

    const results = [
      await queue().submitSponsoredSign({
        network: NEAR_TESTNET,
        signedDelegateAction: fromRelayer.signedDelegateAction,
      }),
      await queue().submitSponsoredSign({ network: "near:mainnet", signedDelegateAction }),
      await queue().submitSponsoredSign({
        network: NEAR_TESTNET,
        signedDelegateAction: base64.encode(new TextEncoder().encode("not a delegate")),
      }),
    ];

    expect(results).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
    ]);
    expect(fake.near.sponsoredSigns).toEqual([]);
  });

  test("refuses the USDC ft_transfer it relays for Sweeps, and the Sweep queue refuses a sign", async () => {
    const fake = installFakeNetwork();
    const secretKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(secretKey);
    const height = await finalHeight(fake.near);
    const transfer = nearSweepDelegateAction({
      senderId: PROVIDER,
      usdc,
      receiverId: "alice.testnet",
      amount: "1",
      nonce: BigInt(height) * 1_000_000n + 1n,
      maxBlockHeight: BigInt(height + 200),
      publicKey,
    });
    const ftTransfer = signedNearDelegate(
      transfer,
      ed25519.sign(nearDelegatePayloadHash(transfer), secretKey),
    );
    const { signedDelegateAction: sign } = await signedSign(fake.near);

    const asSign = await queue().submitSponsoredSign({
      network: NEAR_TESTNET,
      signedDelegateAction: ftTransfer,
    });
    const asSweep = await queue().submitSweep({
      network: NEAR_TESTNET,
      signedDelegateAction: sign,
    });

    expect(asSign).toMatchObject({ ok: false });
    expect(asSweep).toMatchObject({ ok: false, message: expect.stringContaining("ft_transfer") });
    expect(fake.near.sponsoredSigns).toEqual([]);
    expect(fake.near.transfers).toEqual([]);
  });

  test.each<{ case: string; fault: NearChainFaults }>([
    { case: "the block height", fault: { failNextRequests: 1 } },
    { case: "the sender's access key", fault: { failNextKeyReads: 1 } },
  ])(
    "when $case can't be read, the submission rejects having sent nothing, and submitting again sends it once",
    async ({ fault }) => {
      const fake = installFakeNetwork();
      const { signedDelegateAction } = await signedSign(fake.near);
      const submission = { network: NEAR_TESTNET as typeof NEAR_TESTNET, signedDelegateAction };
      Object.assign(fake.near.faults, fault);

      await expect(plainPromise(queue().submitSponsoredSign(submission))).rejects.toThrow();
      expect(fake.near.sponsoredSigns).toEqual([]);

      const again = await queue().submitSponsoredSign(submission);

      expect(again).toMatchObject({ ok: true });
      expect(fake.near.sponsoredSigns).toHaveLength(1);
    },
  );
});
