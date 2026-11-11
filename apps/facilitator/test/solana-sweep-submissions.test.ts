import { networkRegistry } from "@herald/core";
import {
  buildSolanaSweepTransaction,
  usdcTokenAccount,
  withSolanaSignature,
} from "@herald/core/server";
import { getTransferCheckedInstruction } from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, SOLANA_DEVNET } from "./support/network.ts";
import { solanaFeePayer } from "./support/parties.ts";

// The Solana chain queue's Sweep RPC, as the web Worker calls it through its
// cross-Worker Durable Object binding once the MPC network has signed a
// Provider's transfer.

afterEach(() => {
  vi.restoreAllMocks();
});

const usdc = networkRegistry.testnet.find((n) => n.caip2 === SOLANA_DEVNET)!.usdc.address;
const queue = () => env.SOLANA_CHAIN_QUEUE.getByName(SOLANA_DEVNET);
const lifetime = () => ({
  blockhash: getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32))),
  lastValidBlockHeight: 400_000_150,
});

/** A key pair standing in for a Receiving Address's MPC-derived key, and another wallet. */
async function parties() {
  const keys = await generateKeyPair();
  const owner = await getAddressFromPublicKey(keys.publicKey);
  const destination = await getAddressFromPublicKey((await generateKeyPair()).publicKey);
  return { keys, owner, destination };
}

/** Signs a transaction (base64 wire format) as `owner`, as the MPC network would. */
async function signedBy(wire: string, owner: Address, keys: CryptoKeyPair) {
  const { messageBytes } = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const signature = await signBytes(keys.privateKey, messageBytes);
  return withSolanaSignature(wire, owner, signature)!;
}

/** A Sweep as core plans it, signed by the Receiving Address. */
async function sweep(input: { createTokenAccount: boolean; amount?: bigint; feePayer?: string }) {
  const { keys, owner, destination } = await parties();
  const unsigned = await buildSolanaSweepTransaction({
    feePayer: input.feePayer ?? solanaFeePayer(),
    owner,
    destination,
    mint: usdc,
    decimals: 6,
    amount: input.amount ?? 150_000n,
    createTokenAccount: input.createTokenAccount,
    ...lifetime(),
  });
  return { owner, destination, keys, unsigned, transaction: await signedBy(unsigned, owner, keys) };
}

/** A transaction with arbitrary instructions, fee payer Herald's gas wallet, signed by `owner`. */
async function custom(instructions: Instruction[], owner: Address, keys: CryptoKeyPair) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(solanaFeePayer())), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: lifetime().blockhash as Blockhash,
          lastValidBlockHeight: 400_000_150n,
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));
  return signedBy(wire, owner, keys);
}

async function transferChecked(input: {
  from: Address;
  to: Address;
  mint?: string;
  amount?: bigint;
}): Promise<Instruction> {
  const mint = input.mint ?? usdc;
  return getTransferCheckedInstruction({
    source: await usdcTokenAccount(input.from, mint),
    mint: address(mint),
    destination: await usdcTokenAccount(input.to, mint),
    authority: createNoopSigner(input.from),
    amount: input.amount ?? 150_000n,
    decimals: 6,
  });
}

describe("submitting a Solana Sweep", () => {
  test("Herald's gas wallet pays the fee and the transfer lands once; submitting it again answers the same signature", async () => {
    const fake = installFakeNetwork();
    const planned = await sweep({ createTokenAccount: false });
    await fake.solana.createTokenAccount(planned.destination);
    const submission = { network: SOLANA_DEVNET, transaction: planned.transaction } as const;

    const first = await queue().submitSweep(submission);
    const again = await queue().submitSweep(submission);

    expect(first).toEqual({ ok: true, signature: expect.any(String) });
    expect(again).toEqual(first);
    expect(fake.solana.transfers).toEqual([
      {
        signature: first.ok ? first.signature : undefined,
        feePayer: solanaFeePayer(),
        authority: planned.owner,
        destination: await fake.solana.tokenAccountOf(planned.destination),
        amount: 150_000n,
      },
    ]);
  });

  test("creates the destination's USDC token account in the same transaction, with Herald paying the rent", async () => {
    const fake = installFakeNetwork();
    const planned = await sweep({ createTokenAccount: true });

    const result = await queue().submitSweep({
      network: SOLANA_DEVNET,
      transaction: planned.transaction,
    });

    expect(result).toMatchObject({ ok: true });
    expect(fake.solana.tokenAccountCreations).toEqual([
      {
        signature: result.ok ? result.signature : undefined,
        feePayer: solanaFeePayer(),
        owner: planned.destination,
        tokenAccount: await fake.solana.tokenAccountOf(planned.destination),
      },
    ]);
    expect(fake.solana.transfers).toHaveLength(1);
  });

  test("a transfer the node's simulation fails is refused, and nothing lands", async () => {
    const fake = installFakeNetwork();
    // The destination has no token account and the Sweep doesn't create one.
    const planned = await sweep({ createTokenAccount: false });

    const result = await queue().submitSweep({
      network: SOLANA_DEVNET,
      transaction: planned.transaction,
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("refused") });
    expect(fake.solana.transfers).toEqual([]);
  });

  test("refuses a transaction whose fee payer isn't Herald's gas wallet", async () => {
    const fake = installFakeNetwork();
    const other = await getAddressFromPublicKey((await generateKeyPair()).publicKey);
    const planned = await sweep({ createTokenAccount: true, feePayer: other });

    const result = await queue().submitSweep({
      network: SOLANA_DEVNET,
      transaction: planned.transaction,
    });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("fee payer") });
    expect(fake.solana.transfers).toEqual([]);
  });

  test("refuses a Sweep the Receiving Address didn't sign, or signed something else", async () => {
    const fake = installFakeNetwork();
    const planned = await sweep({ createTokenAccount: true });
    const otherSweep = await sweep({ createTokenAccount: true });
    const { messageBytes } = getTransactionDecoder().decode(
      getBase64Encoder().encode(otherSweep.unsigned),
    );
    const wrongSignature = withSolanaSignature(
      planned.unsigned,
      planned.owner,
      await signBytes(planned.keys.privateKey, messageBytes),
    )!;

    const unsigned = await queue().submitSweep({
      network: SOLANA_DEVNET,
      transaction: planned.unsigned,
    });
    const misSigned = await queue().submitSweep({
      network: SOLANA_DEVNET,
      transaction: wrongSignature,
    });

    expect(unsigned).toMatchObject({ ok: false, message: expect.stringContaining("signed") });
    expect(misSigned).toMatchObject({ ok: false, message: expect.stringContaining("verify") });
    expect(fake.solana.transfers).toEqual([]);
  });

  test("refuses to sign anything that moves the gas wallet's own funds", async () => {
    const fake = installFakeNetwork();
    const { keys, owner, destination } = await parties();
    const gasWallet = address(solanaFeePayer());
    // The Receiving Address's transfer, plus one out of the gas wallet's
    // USDC token account, which its signature as fee payer would authorize.
    const transaction = await custom(
      [
        await transferChecked({ from: gasWallet, to: destination }),
        await transferChecked({ from: owner, to: destination }),
      ],
      owner,
      keys,
    );

    const result = await queue().submitSweep({ network: SOLANA_DEVNET, transaction });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("only create") });
    expect(fake.solana.transfers).toEqual([]);
  });

  test("refuses a transfer of another token", async () => {
    installFakeNetwork();
    const { keys, owner, destination } = await parties();
    const otherMint = await getAddressFromPublicKey((await generateKeyPair()).publicKey);
    const transaction = await custom(
      [await transferChecked({ from: owner, to: destination, mint: otherMint })],
      owner,
      keys,
    );

    const result = await queue().submitSweep({ network: SOLANA_DEVNET, transaction });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("USDC only") });
  });
});
