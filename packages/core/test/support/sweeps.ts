import { createDb, providers } from "@herald/db";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import { base58, base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import type { Hex } from "viem";
import {
  ProviderSchema,
  type EvmAddress,
  type Provider,
  type SolanaAddress,
} from "../../src/index.ts";
import type {
  EvmReceiptReader,
  EvmSweepSubmission,
  EvmSweepSubmitter,
  MpcSignRequest,
  NearSweepQueue,
  NearSweepReader,
  NearSweepStatus,
  NearSweepSubmission,
  NearTransactionOutcome,
  NearTransactionReader,
  OneClickClient,
  OneClickQuoteRequest,
  OneClickQuoteResult,
  OneClickSwap,
  SolanaSweepQueue,
  SolanaSweepReader,
  SolanaSweepSubmission,
  UsdcBalanceReader,
} from "../../src/server/index.ts";

const db = () => createDb(env.DB);

/** A fresh ed25519 key and its Solana address. */
export function solanaKeyPair(): { secretKey: Uint8Array; address: SolanaAddress } {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, address: base58.encode(ed25519.getPublicKey(secretKey)) };
}

/**
 * A testnet Provider whose Receiving Addresses belong to throwaway keys the
 * test holds (`receivingKey` on EVM, `solanaKey` on Solana, `nearKey` on
 * NEAR), standing in for
 * the keys the MPC network derives for the Provider Account. Its row is
 * written directly: `registerProvider` would derive addresses from the real
 * MPC root keys, which no test can sign for.
 */
export async function sweepingProvider(accountId: string) {
  const receivingKey = generatePrivateKey();
  const evmAddress = privateKeyToAccount(receivingKey).address.toLowerCase() as EvmAddress;
  const solana = solanaKeyPair();
  // A NEAR Receiving Address is an ed25519 key too, in hex.
  const near = solanaKeyPair();
  const nearAddress = bytesToHex(base58.decode(near.address));
  await db()
    .insert(providers)
    .values({ accountId, evmAddress, solanaAddress: solana.address, nearAddress });
  const [row] = await db().select().from(providers).where(eq(providers.accountId, accountId));
  const provider: Provider = ProviderSchema.parse(row);
  return { provider, receivingKey, solanaKey: solana.secretKey, nearKey: near.secretKey };
}

/** USDC balances keyed by owner address (any network); everyone else holds 0. */
export function usdcBalances(balances: Record<string, string>): UsdcBalanceReader {
  return async ({ owner }) => balances[owner.toLowerCase()] ?? balances[owner] ?? "0";
}

/** Like NEAR RPC's `tx` result, the parts Herald reads. */
type StoredTransaction = NearTransactionOutcome & { senderId: string };

/**
 * A key the fake MPC network signs with: a secp256k1 private key (hex) for
 * ECDSA requests, an ed25519 secret key (bytes) for EdDSA ones.
 */
type MpcKey = Hex | Uint8Array;

/**
 * A fake NEAR network with the MPC signer contract on it. `sign` plays a
 * Provider's wallet sending `v1.signer-prod.testnet.sign`: it records the
 * transaction and its outcome the way NEAR RPC's `tx` method reports them,
 * with the MPC network's answer as the `SuccessValue`. The signing key
 * stands in for the key the MPC network derives for the signer.
 */
export class FakeNear {
  readonly #transactions = new Map<string, StoredTransaction>();

  /** Sends a `sign` call for `request` as `signerId` and returns its NEAR transaction hash. */
  async sign(input: {
    signerId: string;
    request: MpcSignRequest;
    /** The key the MPC network signs with, i.e. the one derived for `signerId`. */
    key: MpcKey;
    /** Ask the MPC network to sign this payload (hex) instead of the planned one. */
    payload?: Hex;
    /** Have the signing transaction fail on NEAR. */
    failure?: unknown;
    /** Leave the MPC network's answer out, as while it is still signing. */
    pending?: boolean;
  }): Promise<string> {
    const { request } = input;
    const requested = request.args.request.payload_v2;
    const scheme = "Ecdsa" in requested ? "Ecdsa" : "Eddsa";
    const payload =
      input.payload ?? (`0x${"Ecdsa" in requested ? requested.Ecdsa : requested.Eddsa}` as Hex);
    const payloadV2 =
      scheme === "Ecdsa" ? { Ecdsa: payload.slice(2) } : { Eddsa: payload.slice(2) };
    const args = { request: { ...request.args.request, payload_v2: payloadV2 } };
    const txHash = base58.encode(crypto.getRandomValues(new Uint8Array(32)));
    let status: NearTransactionOutcome["status"];
    if (input.failure) status = { Failure: input.failure };
    else if (input.pending) status = "Started";
    else status = { SuccessValue: await mpcAnswer(payload, input.key) };
    this.#transactions.set(txHash, {
      senderId: input.signerId,
      status,
      transaction: {
        hash: txHash,
        signer_id: input.signerId,
        receiver_id: request.contractId,
        actions: [
          {
            FunctionCall: {
              method_name: request.methodName,
              args: base64.encode(new TextEncoder().encode(JSON.stringify(args))),
              gas: Number(request.gas),
              deposit: request.deposit,
            },
          },
        ],
      },
    });
    return txHash;
  }

  /** The MPC network finishes signing a transaction `sign` left pending. */
  async finish(txHash: string, payload: Hex, key: MpcKey): Promise<void> {
    const stored = this.#transactions.get(txHash);
    if (stored) stored.status = { SuccessValue: await mpcAnswer(payload, key) };
  }

  /** A `NearTransactionReader` over this network; unknown transactions are null. */
  readonly readTransaction: NearTransactionReader = async ({ txHash, senderId }) => {
    const stored = this.#transactions.get(txHash);
    if (!stored || stored.senderId !== senderId) return null;
    const { senderId: _, ...outcome } = stored;
    return structuredClone(outcome);
  };
}

/**
 * The MPC network's answer to a `sign` call, base64 JSON as NEAR returns it.
 * Shapes read from live transactions: `v1.signer-prod.testnet` for ECDSA,
 * `v1.signer` tx CLhgqus9hkSPMu93UdTw6oUj71Rg9KWbNiPQn1psNAo1 for EdDSA.
 *
 * - ECDSA (secp256k1 `key`): `big_r` is R in compressed form, `s` low-s
 *   normalized, and `recovery_id` R's y parity.
 * - EdDSA (ed25519 `key`): `signature` is the 64-byte signature of the
 *   payload bytes, as an array of numbers.
 */
async function mpcAnswer(payload: Hex, key: MpcKey): Promise<string> {
  let answer: unknown;
  if (typeof key === "string") {
    const signature = await sign({ hash: payload, privateKey: key });
    answer = {
      scheme: "Secp256k1",
      big_r: { affine_point: `${signature.yParity ? "03" : "02"}${signature.r.slice(2)}` },
      s: { scalar: signature.s.slice(2) },
      recovery_id: signature.yParity,
    };
  } else {
    const signature = ed25519.sign(hexToBytes(payload.slice(2)), key);
    answer = { scheme: "Ed25519", signature: Array.from(signature) };
  }
  return base64.encode(new TextEncoder().encode(JSON.stringify(answer)));
}

/** Herald's chain queue, faked: it records every submission and answers with a hash. */
export class FakeChainQueue {
  readonly submissions: EvmSweepSubmission[] = [];
  /** Refuse submissions with this message, as the queue does when a broadcast fails. */
  refuseWith: string | null = null;
  /** Throw instead of answering, as when the queue can't be reached. */
  unreachable = false;

  readonly submit: EvmSweepSubmitter = async (submission) => {
    if (this.unreachable) throw new Error("The EVM chain queue didn't answer");
    if (this.refuseWith) return { ok: false, message: this.refuseWith };
    this.submissions.push(submission);
    return {
      ok: true,
      hash: `0x${"ab".repeat(31)}${this.submissions.length.toString(16).padStart(2, "0")}`,
    };
  };
}

/** Receipts by transaction hash; unknown hashes have none yet. */
export function fakeReceipts(receipts: Record<string, "success" | "reverted"> = {}) {
  const read: EvmReceiptReader = async ({ hash }) => receipts[hash] ?? null;
  return { receipts, read };
}

/** Solana's System Program, which owns every wallet account. */
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/**
 * A fake Solana network and Herald's Solana chain queue on it. `reader`
 * answers what Herald reads from Solana RPC: accounts (by the program that
 * owns them), the latest blockhash, the block height and signature
 * statuses. `queue` is the chain queue: its fee payer, and Sweep
 * submissions, which it records and answers with a transaction signature.
 */
export class FakeSolana {
  readonly feePayer = solanaKeyPair().address;
  /** The program owning each account that exists, by address. */
  readonly accounts = new Map<string, string>();
  /** Signature statuses: transactions not listed haven't landed. */
  readonly statuses = new Map<string, "success" | "failed">();
  readonly submissions: SolanaSweepSubmission[] = [];
  blockHeight = 300_000_000;
  /** How many blocks past the current height each new blockhash lasts. */
  blockhashLifetime = 150;
  /** Fail every RPC read, as when the endpoint is down. */
  readsFail = false;
  /** Refuse submissions with this message, as the queue does when preflight fails. */
  refuseWith: string | null = null;
  /** Throw instead of answering, as when the queue can't be reached. */
  queueUnreachable = false;

  /** Creates `owner`'s USDC token account on `mint` and returns its address. */
  async addTokenAccount(owner: string, mint: string): Promise<string> {
    const tokenAccount = await tokenAccountOf(owner, mint);
    this.accounts.set(tokenAccount, TOKEN_PROGRAM_ADDRESS);
    return tokenAccount;
  }

  readonly reader: SolanaSweepReader = {
    latestBlockhash: async () => {
      this.#read();
      return {
        blockhash: base58.encode(crypto.getRandomValues(new Uint8Array(32))),
        lastValidBlockHeight: this.blockHeight + this.blockhashLifetime,
      };
    },
    accountOwner: async ({ account }) => {
      this.#read();
      return this.accounts.get(account) ?? null;
    },
    blockHeight: async () => {
      this.#read();
      return this.blockHeight;
    },
    signatureStatus: async ({ signature }) => {
      this.#read();
      return this.statuses.get(signature) ?? null;
    },
  };

  readonly queue: SolanaSweepQueue = {
    feePayer: async () => {
      if (this.queueUnreachable) throw new Error("The Solana chain queue didn't answer");
      return this.feePayer;
    },
    submitSweep: async (submission) => {
      if (this.queueUnreachable) throw new Error("The Solana chain queue didn't answer");
      if (this.refuseWith) return { ok: false, message: this.refuseWith };
      this.submissions.push(submission);
      // Like the real queue: the same transaction always gets the same
      // signature (the fee payer's, which any 64 bytes stand in for).
      let signature = this.#signatures.get(submission.transaction);
      if (!signature) {
        signature = base58.encode(crypto.getRandomValues(new Uint8Array(64)));
        this.#signatures.set(submission.transaction, signature);
      }
      return { ok: true, signature };
    },
  };

  readonly #signatures = new Map<string, string>();

  #read() {
    if (this.readsFail) throw new Error("Solana Devnet RPC request failed (TypeError)");
  }
}

/**
 * A fake NEAR network with USDC on it, and Herald's NEAR chain queue. The
 * `reader` answers what Herald reads to plan and follow Sweeps: access-key
 * nonces of implicit accounts (`addAccount`), USDC storage registration
 * (`registered`), the final block height and relayer transactions'
 * outcomes (`statuses`, unknown ones not executed yet). The `queue` is the
 * chain queue: it records each Sweep submission and answers a relayer
 * transaction hash, the same one for the same signed delegate action.
 */
export class FakeNearUsdc {
  /** Herald's relayer, an implicit account. */
  readonly relayer = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  /** Accounts registered on USDC (NEP-145). */
  readonly registered = new Set<string>();
  /** How each relayer transaction ended; those not listed haven't executed. */
  readonly statuses = new Map<string, NearSweepStatus>();
  readonly submissions: NearSweepSubmission[] = [];
  height = 200_000_000;
  /** Fail every RPC read, as when the endpoint is down. */
  readsFail = false;
  /** Refuse submissions with this message, as the queue does for an expired delegate. */
  refuseWith: string | null = null;
  /** Throw instead of answering, as when the queue can't be reached. */
  queueUnreachable = false;
  readonly #keyNonces = new Map<string, bigint>();
  readonly #transactions = new Map<string, string>();

  /**
   * Creates the implicit account `accountId` (64 hex characters) with its
   * own key as a full-access key, registered on USDC, as Herald's setup
   * does. Its key nonce starts at the creation height × 10^6.
   */
  addAccount(accountId: string): void {
    this.#keyNonces.set(accountId, BigInt(this.height) * 1_000_000n);
    this.registered.add(accountId);
  }

  keyNonceOf(accountId: string): bigint | undefined {
    return this.#keyNonces.get(accountId);
  }

  readonly reader: NearSweepReader = {
    accessKeyNonce: async ({ accountId, publicKey }) => {
      this.#read();
      // An implicit account's key is the one its id names.
      if (bytesToHex(publicKey) !== accountId) return null;
      return this.#keyNonces.get(accountId) ?? null;
    },
    storageRegistered: async ({ accountId }) => {
      this.#read();
      return this.registered.has(accountId);
    },
    finalBlockHeight: async () => {
      this.#read();
      return this.height;
    },
    sweepStatus: async ({ txHash }) => {
      this.#read();
      return this.statuses.get(txHash) ?? null;
    },
  };

  readonly queue: NearSweepQueue = {
    relayer: async () => {
      if (this.queueUnreachable) throw new Error("The NEAR chain queue didn't answer");
      return this.relayer;
    },
    submitSweep: async (submission) => {
      if (this.queueUnreachable) throw new Error("The NEAR chain queue didn't answer");
      if (this.refuseWith) return { ok: false, message: this.refuseWith };
      this.submissions.push(submission);
      let transaction = this.#transactions.get(submission.signedDelegateAction);
      if (!transaction) {
        transaction = base58.encode(crypto.getRandomValues(new Uint8Array(32)));
        this.#transactions.set(submission.signedDelegateAction, transaction);
      }
      return { ok: true, transaction };
    },
  };

  #read() {
    if (this.readsFail) throw new Error("NEAR RPC block request failed (TypeError)");
  }
}

/** The USDC token account (associated token account) of `owner`. */
export async function tokenAccountOf(owner: string, mint: string): Promise<string> {
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return tokenAccount;
}

/** 1Click's id of USDC on NEAR mainnet: Circle's NEP-141 contract. */
const NEAR_USDC_1CS = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** A fresh deposit address on the chain of 1Click's `originAsset`. */
function depositAddressFor(originAsset: string): string {
  // On NEAR, 1Click answers a fresh implicit account that doesn't exist yet
  // and isn't registered on USDC (read from a live quote on 2026-11-13).
  if (originAsset === NEAR_USDC_1CS) {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  }
  if (originAsset.startsWith("nep141:sol-")) return solanaKeyPair().address;
  return privateKeyToAccount(generatePrivateKey()).address;
}

/**
 * A fake 1Click. `client` quotes every request it records in `quotes`,
 * keeping `fee` base units and answering a fresh deposit address on the
 * origin chain (a NEAR implicit account, a Solana address or an EVM one),
 * with the requested deadline. `swaps` holds each deposit address's status, set by
 * the test the way 1Click would move it on; addresses not listed are
 * unknown (404).
 */
export class FakeOneClick {
  readonly quotes: OneClickQuoteRequest[] = [];
  readonly swaps = new Map<string, OneClickSwap>();
  /** What 1Click keeps of each quote, base units. */
  fee = 1_000n;
  /** What it keeps if it refunds, base units. */
  refundFee = 2_400n;
  /** Answer quote requests with this refusal instead. */
  refusal: Extract<OneClickQuoteResult, { ok: false }> | null = null;
  /** Throw instead of answering, as when 1Click can't be reached. */
  unreachable = false;
  /** Change each quote before answering it, as a misbehaving 1Click would. */
  tamper: ((quote: Extract<OneClickQuoteResult, { ok: true }>["quote"]) => void) | null = null;

  readonly client: OneClickClient = {
    quote: async (request) => {
      if (this.unreachable) throw new Error("1Click quote request failed (TypeError)");
      this.quotes.push(request);
      if (this.refusal) return this.refusal;
      const amountOut = BigInt(request.amount) - this.fee;
      const quote = {
        quoteId: crypto.randomUUID(),
        depositAddress: depositAddressFor(request.originAsset),
        amountIn: request.amount,
        amountOut: String(amountOut),
        minAmountOut: String((amountOut * 995n) / 1000n),
        refundFee: String(this.refundFee),
        timeEstimate: 34,
        deadline: request.deadline,
        timeWhenInactive: null,
        signature: `ed25519:${base58.encode(crypto.getRandomValues(new Uint8Array(64)))}`,
      };
      this.tamper?.(quote);
      return { ok: true, quote };
    },
    status: async (depositAddress) => {
      if (this.unreachable) throw new Error("1Click status request failed (TypeError)");
      const swap = this.swaps.get(depositAddress);
      return swap ? structuredClone(swap) : null;
    },
  };

  /** 1Click moves the swap at `depositAddress` to `status`, with `details`. */
  report(
    depositAddress: string,
    status: OneClickSwap["status"],
    details: Partial<Omit<OneClickSwap, "status">> = {},
  ): void {
    this.swaps.set(depositAddress, {
      status,
      amountOut: null,
      refundedAmount: null,
      refundReason: null,
      destinationTxHashes: [],
      ...details,
    });
  }
}
