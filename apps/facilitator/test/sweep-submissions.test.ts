import { networkRegistry } from "@herald/core";
import { eip3009ABI } from "@x402/evm";
import { env } from "cloudflare:workers";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork } from "./support/network.ts";

// The EVM chain queue's Sweep RPC, as the web Worker calls it through its
// cross-Worker Durable Object binding once the MPC network has signed a
// Provider's transfer.

afterEach(() => {
  vi.restoreAllMocks();
});

const network = "eip155:84532";
const usdc = networkRegistry.testnet.find((n) => n.caip2 === network)!.usdc.address as Address;
// Checksummed, as the fake chain reports decoded addresses.
const receivingAddress = getAddress("0x00000000000000000000000000000000000a11ce");
const destination = getAddress("0x000000000000000000000000000000000000d00d");

/** A signed `transferWithAuthorization` from the Receiving Address; the fake chain doesn't check signatures. */
function sweepTransfer(nonce: Hex): Hex {
  return encodeFunctionData({
    abi: eip3009ABI,
    functionName: "transferWithAuthorization",
    args: [
      receivingAddress,
      destination,
      150_000n,
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 600),
      nonce,
      27,
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
    ],
  });
}

describe("submitting a Sweep", () => {
  test("Herald's gas wallet sends it once, and submitting it again answers the same hash", async () => {
    const fake = installFakeNetwork();
    const queue = env.EVM_CHAIN_QUEUE.getByName(network);
    const submission = {
      network,
      asset: usdc,
      data: sweepTransfer(`0x${"5e".repeat(32)}`),
    } as const;

    const first = await queue.submitSweep(submission);
    const again = await queue.submitSweep(submission);

    expect(first).toEqual({ ok: true, hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(again).toEqual(first);
    expect(fake.chains[network]?.submissions).toEqual([
      expect.objectContaining({
        hash: first.ok ? first.hash : undefined,
        sender: privateKeyToAccount(env.EVM_GAS_KEY as Hex).address,
        from: receivingAddress,
        to: destination,
      }),
    ]);
  });

  test("a transfer that would revert is refused without sending anything", async () => {
    const fake = installFakeNetwork();
    const chain = fake.chains[network]!;
    chain.faults.rejectMethods = {
      methods: ["eth_estimateGas"],
      message: "execution reverted: FiatTokenV2: invalid signature",
    };
    const queue = env.EVM_CHAIN_QUEUE.getByName(network);

    const result = await queue.submitSweep({
      network,
      asset: usdc,
      data: sweepTransfer(`0x${"60".repeat(32)}`),
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("revert") });
    expect(chain.submissions).toEqual([]);
  });

  test("a settlement can't reuse an authorization a Sweep submitted", async () => {
    const fake = installFakeNetwork();
    const queue = env.EVM_CHAIN_QUEUE.getByName(network);
    const submission = {
      network,
      asset: usdc,
      data: sweepTransfer(`0x${"5f".repeat(32)}`),
    } as const;

    await queue.submitSweep(submission);
    const settlement = await queue.submitTransferWithAuthorization(submission);

    expect(settlement).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(fake.chains[network]?.submissions).toHaveLength(1);
  });
});
