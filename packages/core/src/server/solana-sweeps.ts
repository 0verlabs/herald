import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type SignatureBytes,
} from "@solana/kit";
import type { Caip2, Network } from "../networks.ts";
import { callJsonRpc } from "../rpc.ts";

/**
 * What Herald reads from a Solana network to plan and follow Sweeps. Each
 * read rejects if the network can't be read.
 */
export type SolanaSweepReader = {
  /** A recent blockhash (`confirmed`) and the last block height a transaction using it can land at. */
  latestBlockhash(request: {
    network: Network;
  }): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  /** The program that owns `account`, or null if no account lives there. */
  accountOwner(request: { network: Network; account: string }): Promise<string | null>;
  /** The current block height, `finalized`: no transaction can land past it below this. */
  blockHeight(request: { network: Network }): Promise<number>;
  /**
   * Whether a transaction landed (`confirmed` or better): `success`,
   * `failed`, or null while it hasn't.
   */
  signatureStatus(request: {
    network: Network;
    signature: string;
  }): Promise<"success" | "failed" | null>;
};

/**
 * A Sweep's transaction on a Solana network, base64 wire format, signed by
 * the Receiving Address, with the fee payer's signature still missing.
 */
export type SolanaSweepSubmission = { network: Caip2; transaction: string };

/** The queue's answer to a Sweep: the transaction's signature, or why it refused it. */
export type SolanaSweepSubmissionResult =
  | { ok: true; signature: string }
  | { ok: false; message: string };

/**
 * Herald's Solana chain queue for Sweeps (the `SolanaChainQueue` Durable
 * Object in `apps/facilitator`), which holds the gas wallet.
 */
export type SolanaSweepQueue = {
  /** The gas wallet's address on `network`: every Solana Sweep's fee payer. */
  feePayer(network: Caip2): Promise<string>;
  /**
   * Adds the fee payer's signature and sends the transaction, answering its
   * signature. Submitting the same transaction again answers the same
   * signature (broadcasting it again, which can't make it land twice).
   * Refuses (`ok: false`) a transaction that isn't a Sweep or that the
   * network rejected. Rejects if the queue can't be reached, in which case
   * submitting again is safe.
   */
  submitSweep(submission: SolanaSweepSubmission): Promise<SolanaSweepSubmissionResult>;
};

/** The SPL Token-2022 program. Its accounts can't hold USDC, which is a classic SPL token. */
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Solana's System Program, which owns ordinary wallets. */
export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

/** The USDC token account (associated token account) of `owner` for `mint`. */
export async function usdcTokenAccount(owner: string, mint: string): Promise<Address> {
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return tokenAccount;
}

/**
 * The unsigned transaction of a same-chain Solana Sweep, base64 wire format:
 * a `TransferChecked` of `amount` USDC base units from `owner`'s USDC token
 * account to `destination`'s, authorized by `owner`, with `feePayer` paying
 * the fee. When `createTokenAccount` is set, it first creates the
 * destination's token account (idempotent), with `feePayer` paying the rent.
 * Its signers are `feePayer`, then `owner`.
 */
export async function buildSolanaSweepTransaction(input: {
  feePayer: string;
  owner: string;
  destination: string;
  mint: string;
  decimals: number;
  amount: bigint;
  createTokenAccount: boolean;
  blockhash: string;
  lastValidBlockHeight: number;
}): Promise<string> {
  const mint = address(input.mint);
  const payer = createNoopSigner(address(input.feePayer));
  const owner = createNoopSigner(address(input.owner));
  const [source, destination] = await Promise.all([
    usdcTokenAccount(input.owner, input.mint),
    usdcTokenAccount(input.destination, input.mint),
  ]);
  const transfer = getTransferCheckedInstruction({
    source,
    mint,
    destination,
    authority: owner,
    amount: input.amount,
    decimals: input.decimals,
  });
  const instructions = input.createTokenAccount
    ? [
        getCreateAssociatedTokenIdempotentInstruction({
          payer,
          ata: destination,
          owner: address(input.destination),
          mint,
        }),
        transfer,
      ]
    : [transfer];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: input.blockhash as Blockhash,
          lastValidBlockHeight: BigInt(input.lastValidBlockHeight),
        },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

function decodeWireTransaction(wire: string) {
  return getTransactionDecoder().decode(getBase64Encoder().encode(wire));
}

/** The message of a transaction (base64 wire format): the bytes its signers sign. */
export function solanaTransactionMessage(wire: string): Uint8Array {
  return new Uint8Array(decodeWireTransaction(wire).messageBytes);
}

/**
 * A transaction (base64 wire format) with `signer`'s signature in place, or
 * null if `signer` isn't one of its signers.
 */
export function withSolanaSignature(
  wire: string,
  signer: string,
  signature: Uint8Array,
): string | null {
  const transaction = decodeWireTransaction(wire);
  if (!Object.hasOwn(transaction.signatures, signer)) return null;
  // The wire format lists signatures in the message's signer order, which
  // is the map's key order, so the map is copied in order.
  return getBase64EncodedWireTransaction({
    ...transaction,
    signatures: Object.freeze({
      ...transaction.signatures,
      [signer]: signature as SignatureBytes,
    }),
  });
}

const SOLANA_READ_TIMEOUT_MS = 8_000;

/**
 * A `SolanaSweepReader` over each Solana network's JSON-RPC endpoint, from
 * `rpcUrls` keyed by CAIP-2 network. Errors never include the endpoint,
 * whose URL may carry an API key.
 */
export function rpcSolanaSweepReader(
  rpcUrls: Partial<Record<Caip2, string>>,
  fetchFn: typeof fetch = fetch,
): SolanaSweepReader {
  const call = (network: Network, method: string, params: unknown[]) => {
    const url = rpcUrls[network.caip2];
    if (!url) throw new Error(`Herald has no RPC endpoint for ${network.label}`);
    return callJsonRpc(fetchFn, url, network.label, method, params, SOLANA_READ_TIMEOUT_MS);
  };
  return {
    latestBlockhash: async ({ network }) => {
      const result = (await call(network, "getLatestBlockhash", [{ commitment: "confirmed" }])) as {
        value?: { blockhash?: unknown; lastValidBlockHeight?: unknown };
      } | null;
      const { blockhash, lastValidBlockHeight } = result?.value ?? {};
      if (typeof blockhash !== "string" || typeof lastValidBlockHeight !== "number") {
        throw new Error(`${network.label} answered getLatestBlockhash without a blockhash`);
      }
      return { blockhash, lastValidBlockHeight };
    },
    accountOwner: async ({ network, account }) => {
      const result = (await call(network, "getAccountInfo", [
        account,
        { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } },
      ])) as { value?: { owner?: unknown } | null } | null;
      if (result?.value === null) return null;
      const owner = result?.value?.owner;
      if (typeof owner !== "string") {
        throw new Error(`${network.label} answered getAccountInfo without an owner`);
      }
      return owner;
    },
    blockHeight: async ({ network }) => {
      const height = await call(network, "getBlockHeight", [{ commitment: "finalized" }]);
      if (typeof height !== "number") {
        throw new Error(`${network.label} answered getBlockHeight with ${JSON.stringify(height)}`);
      }
      return height;
    },
    signatureStatus: async ({ network, signature }) => {
      const result = (await call(network, "getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ])) as { value?: ({ err?: unknown; confirmationStatus?: unknown } | null)[] } | null;
      if (!Array.isArray(result?.value)) {
        throw new Error(`${network.label} answered getSignatureStatuses without statuses`);
      }
      const [status] = result.value;
      if (!status) return null;
      if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") {
        return null;
      }
      return status.err === null || status.err === undefined ? "success" : "failed";
    },
  };
}
