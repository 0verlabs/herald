import { createDb, providers } from "@herald/db";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/curves/utils.js";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import { base58, base64 } from "@scure/base";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  actions,
  buildDelegateAction,
  decodeSignedTransaction,
  encodeSignedDelegate,
  KeyPairSigner,
  type KeyPairEd25519,
} from "near-api-js";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import type { Hex } from "viem";
import {
  ProviderSchema,
  type EvmAddress,
  type Provider,
  type SolanaAddress,
} from "../../src/index.ts";
import { delegateAction, signedRelayerTransaction } from "../../src/server/index.ts";
import type {
  EvmReceiptReader,
  EvmSweepSubmission,
  EvmSweepSubmitter,
  MpcSignRequest,
  NearProviderAccountJob,
  NearSponsoredSignSubmission,
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
type StoredTransaction = NearTransactionOutcome & {
  senderId: string;
  /** For a relayed `sign`: the MPC signer, whose receipt holds the answer. */
  mpcContract?: string;
};

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
    if (!stored) return;
    const answer = await mpcAnswer(payload, key);
    const relayedSign = stored.receipts_outcome?.find(
      (r) => r.outcome?.executor_id === stored.mpcContract && r.outcome?.status === "pending",
    );
    if (relayedSign?.outcome) relayedSign.outcome.status = { SuccessValue: answer };
    else stored.status = { SuccessValue: answer };
  }

  /** Herald's NEAR relayer, an implicit account, as the chain queue names it. */
  readonly relayer = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  /** Every sponsored `sign` handed to the relayer, in order, duplicates included. */
  readonly sponsoredSubmissions: NearSponsoredSignSubmission[] = [];
  /** Refuse sponsored signs with this message, as the chain queue does. */
  refuseSponsoredWith: string | null = null;
  /** Throw instead of answering, as when the chain queue can't be reached. */
  relayUnreachable = false;
  /** Have each relayed delegate action fail on NEAR with this error, as a used nonce does. */
  failRelayedDelegateWith: unknown = null;
  /** Leave the MPC network's answer to relayed signs out, as while it is still signing. */
  pendingRelayedSigns = false;
  /**
   * Check relayed delegate actions' nonces as NEAR does: each must be above
   * its sender's key nonce, which landing one raises to it, or it fails with
   * `DelegateActionInvalidNonce`. Off by default, so tests can reuse nonces.
   */
  checkNonces = false;
  readonly #keyNonces = new Map<string, bigint>();
  readonly #derivedKeys = new Map<string, MpcKey>();
  readonly #relayed = new Map<string, string>();
  readonly #relayerKey = ed25519.utils.randomSecretKey();

  /** The key the MPC network derives for `accountId` on `path`, which relayed signs sign with. */
  derive(accountId: string, path: string, key: MpcKey): void {
    this.#derivedKeys.set(`${accountId}/${path}`, key);
  }

  /**
   * The chain queue's `submitSponsoredSign`: the relayer wraps the signed
   * delegate action in a transaction of its own, which lands at once. Its
   * outcome is the way NEAR RPC's `tx` reports a relayed `sign` (#46): the
   * top-level status is the delegate receipt's empty `SuccessValue`, and
   * the MPC signer's second receipt holds the signature, by the key
   * `derive` gave the delegate's sender for the path. The same signed
   * delegate action always answers the same transaction.
   */
  readonly relaySign: NearSweepQueue["submitSponsoredSign"] = async (submission) => {
    if (this.relayUnreachable) throw new Error("The NEAR chain queue didn't answer");
    this.sponsoredSubmissions.push(submission);
    if (this.refuseSponsoredWith) return { ok: false, message: this.refuseSponsoredWith };
    const known = this.#relayed.get(submission.signedDelegateAction);
    if (known) return { ok: true, transaction: known, relayer: this.relayer };

    // Read the delegate action with near-api-js, not with Herald's decoder.
    const wrapped = signedRelayerTransaction({
      relayer: {
        accountId: this.relayer,
        publicKey: ed25519.getPublicKey(this.#relayerKey),
        seed: this.#relayerKey,
      },
      receiverId: "unread.testnet",
      nonce: 1n,
      blockHash: new Uint8Array(32),
      actions: [delegateAction(base64.decode(submission.signedDelegateAction))],
    });
    const decoded = decodeSignedTransaction(wrapped.bytes).transaction.actions[0]?.signedDelegate;
    const delegate = decoded?.delegateAction;
    const call = delegate?.actions[0]?.functionCall;
    if (!delegate || !call) throw new Error("FakeNear: relay a delegate action holding a sign");
    const { request } = JSON.parse(new TextDecoder().decode(new Uint8Array(call.args))) as {
      request: MpcSignRequest["args"]["request"];
    };
    const key = this.#derivedKeys.get(`${delegate.senderId}/${request.path}`);
    const payload =
      `0x${"Ecdsa" in request.payload_v2 ? request.payload_v2.Ecdsa : request.payload_v2.Eddsa}` as Hex;

    const txHash = base58.encode(crypto.getRandomValues(new Uint8Array(32)));
    const receipt = (executor: string, status: unknown) => ({
      outcome: { executor_id: executor, status },
    });
    const keyNonce = this.#keyNonces.get(delegate.senderId) ?? 0n;
    const usedNonce = this.checkNonces && BigInt(delegate.nonce) <= keyNonce;
    if (this.checkNonces && !usedNonce)
      this.#keyNonces.set(delegate.senderId, BigInt(delegate.nonce));
    const failureKind = usedNonce
      ? {
          DelegateActionInvalidNonce: {
            delegate_nonce: Number(delegate.nonce),
            ak_nonce: Number(keyNonce),
          },
        }
      : this.failRelayedDelegateWith;
    const failure = failureKind ? { ActionError: { index: 0, kind: failureKind } } : null;
    const receipts = failure
      ? [
          receipt(delegate.senderId, { Failure: failure }),
          receipt(this.relayer, { SuccessValue: "" }),
        ]
      : [
          receipt(delegate.senderId, { SuccessValue: "" }),
          // The MPC signer yields, then answers in a second receipt.
          receipt(delegate.receiverId, { SuccessReceiptId: "yield" }),
          receipt(
            delegate.receiverId,
            this.pendingRelayedSigns || !key
              ? "pending"
              : { SuccessValue: await mpcAnswer(payload, key) },
          ),
          receipt(this.relayer, { SuccessValue: "" }),
        ];
    this.#transactions.set(txHash, {
      senderId: this.relayer,
      mpcContract: delegate.receiverId,
      status: failure ? { Failure: failure } : { SuccessValue: "" },
      transaction: {
        hash: txHash,
        signer_id: this.relayer,
        receiver_id: delegate.senderId,
        actions: [{ Delegate: {} }],
      },
      receipts_outcome: receipts,
    });
    this.#relayed.set(submission.signedDelegateAction, txHash);
    return { ok: true, transaction: txHash, relayer: this.relayer };
  };

  /** Accounts on NEAR, for `createAccount`: those it created and those `existing` names. */
  readonly existing = new Set<string>();
  /** Every Provider Account creation the chain queue was asked for, in order, repeats included. */
  readonly accountJobs: NearProviderAccountJob[] = [];
  /** The relayer transaction that created each account, by account. */
  readonly createdAccounts = new Map<string, string>();
  /** Refuse Provider Account creations with this message, as when the transfer isn't final in time. */
  refuseAccountWith: string | null = null;
  /** Throw instead of creating, as when the chain queue can't be reached. */
  accountUnreachable = false;

  /**
   * The chain queue's `createProviderAccount`: answers the transaction that
   * created the account, the same one each time, sending a new one only
   * for an account that isn't on NEAR; null for one that was there
   * already.
   */
  readonly createAccount: NearSweepQueue["createProviderAccount"] = async (job) => {
    if (this.accountUnreachable) throw new Error("The NEAR chain queue didn't answer");
    this.accountJobs.push(job);
    if (this.refuseAccountWith) return { ok: false, message: this.refuseAccountWith };
    const created = this.createdAccounts.get(job.account);
    if (created) return { ok: true, transaction: created };
    if (this.existing.has(job.account)) return { ok: true, transaction: null };
    const transaction = base58.encode(crypto.getRandomValues(new Uint8Array(32)));
    this.createdAccounts.set(job.account, transaction);
    this.existing.add(job.account);
    return { ok: true, transaction };
  };

  /** A `NearTransactionReader` over this network; unknown transactions are null. */
  readonly readTransaction: NearTransactionReader = async ({ txHash, senderId }) => {
    const stored = this.#transactions.get(txHash);
    if (!stored || stored.senderId !== senderId) return null;
    const { senderId: _, mpcContract: __, ...outcome } = stored;
    // A receipt still running isn't reported yet.
    const receipts = outcome.receipts_outcome?.filter((r) => r.outcome?.status !== "pending");
    return structuredClone(receipts ? { ...outcome, receipts_outcome: receipts } : outcome);
  };
}

/**
 * A NEP-366 signed delegate action (base64 Borsh) from `accountId` holding
 * one MPC `sign` call for `request`, signed with `key`, the way a NEAR
 * wallet answers `signDelegateActions` (near-api-js encodes it, not
 * Herald). `change` alters what the wallet signs, as a tampering dashboard
 * or wallet would.
 */
export async function walletSignedSign(input: {
  accountId: string;
  key: KeyPairEd25519;
  request: MpcSignRequest;
  nonce?: bigint;
  maxBlockHeight?: bigint;
  change?: {
    receiverId?: string;
    methodName?: string;
    args?: object;
    gas?: bigint;
    deposit?: bigint;
    /** Add a second action after the `sign` call. */
    extraAction?: boolean;
  };
}): Promise<string> {
  const { request, change = {} } = input;
  const sign = actions.functionCall(
    change.methodName ?? request.methodName,
    change.args ?? request.args,
    change.gas ?? BigInt(request.gas),
    change.deposit ?? BigInt(request.deposit),
  );
  const delegate = buildDelegateAction({
    senderId: input.accountId,
    receiverId: change.receiverId ?? request.contractId,
    actions: change.extraAction ? [sign, actions.functionCall("ft_transfer", {}, 1n, 1n)] : [sign],
    nonce: input.nonce ?? 1_000_001n,
    maxBlockHeight: input.maxBlockHeight ?? 200_000_200n,
    publicKey: input.key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(input.key).signDelegateAction(delegate);
  return base64.encode(encodeSignedDelegate(signedDelegate));
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
    submitSponsoredSign: async () => {
      throw new Error("This fake NEAR relays no sponsored sign: use FakeNear's relaySign");
    },
    createProviderAccount: async () => {
      throw new Error("This fake NEAR creates no Provider Account: use FakeNear's createAccount");
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
