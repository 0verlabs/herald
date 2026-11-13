import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import { postRpc } from "../rpc.ts";
import type { NearReceiptStatus } from "./near-chain-queue.ts";

// NEAR protocol code Herald shares between its Workers: the Borsh encoding
// of the transactions and delegate actions Herald builds, JSON-RPC calls,
// and reading a transaction's outcome. The encoding is written out instead
// of pulling in a NEAR library: these are a handful of fixed fields, and a
// Buyer's signed delegate action goes in as the bytes it arrived as, so
// nothing of it is decoded and re-encoded.
// https://nomicon.io/RuntimeSpec/Transactions
// https://github.com/near/NEPs/blob/master/neps/nep-0366.md
// https://github.com/near/NEPs/blob/master/neps/nep-0461.md

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u128(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value & 0xffff_ffff_ffff_ffffn, true);
  view.setBigUint64(8, value >> 64n, true);
  return bytes;
}

/** Borsh `Vec<u8>`: the length (u32), then the bytes. */
function byteString(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32(bytes.length), bytes);
}

/** Borsh `String`: the UTF-8 bytes of `value` as a byte string. */
function utf8ByteString(value: string): Uint8Array {
  return byteString(textEncoder.encode(value));
}

// `PublicKey` and `Signature` start with their key type; 0 is ed25519.
const ED25519 = new Uint8Array([0]);

// `Action` variant tags.
const FUNCTION_CALL_TAG = new Uint8Array([2]);
const TRANSFER_TAG = new Uint8Array([3]);
const DELEGATE_TAG = new Uint8Array([8]);

// NEP-461's discriminant for a delegate action: 2^30 + 366.
const NEP_366_PREFIX = 2 ** 30 + 366;

/** A Borsh-encoded `Action`, for `signedRelayerTransaction` and `encodeDelegateAction`. */
export type NearAction = Uint8Array & { readonly __nearAction: unique symbol };

/** `Action::Delegate`: a signed delegate action (NEP-366), as the Borsh bytes it was signed as. */
export function delegateAction(signedDelegate: Uint8Array): NearAction {
  return concatBytes(DELEGATE_TAG, signedDelegate) as NearAction;
}

/** `Action::Transfer` of `deposit` yoctoNEAR. */
export function transferAction(deposit: bigint): NearAction {
  return concatBytes(TRANSFER_TAG, u128(deposit)) as NearAction;
}

/** `Action::FunctionCall` with JSON `args`. */
export function functionCallAction(input: {
  methodName: string;
  args: object;
  gas: bigint;
  deposit: bigint;
}): NearAction {
  return concatBytes(
    FUNCTION_CALL_TAG,
    utf8ByteString(input.methodName),
    utf8ByteString(JSON.stringify(input.args)),
    u64(input.gas),
    u128(input.deposit),
  ) as NearAction;
}

/** A signed relayer transaction, ready for `send_tx`, and its hash. */
export type SignedNearTransaction = {
  /** base58 of the SHA-256 of the transaction: what NEAR calls its hash. */
  hash: string;
  /** The Borsh `SignedTransaction`, base64 for `send_tx`'s `signed_tx_base64`. */
  bytes: Uint8Array;
};

/**
 * Builds and signs a transaction from the relayer to `receiverId` holding
 * `actions`. To relay a signed delegate action, the receiver is the
 * delegate's sender and the one action is `delegateAction`. `blockHash`
 * (32 bytes) is a recent block, and `nonce` must be above the relayer key's.
 */
export function signedRelayerTransaction(input: {
  relayer: { accountId: string; publicKey: Uint8Array; seed: Uint8Array };
  receiverId: string;
  nonce: bigint;
  blockHash: Uint8Array;
  actions: NearAction[];
}): SignedNearTransaction {
  const { relayer } = input;
  const transaction = concatBytes(
    utf8ByteString(relayer.accountId),
    ED25519,
    relayer.publicKey,
    u64(input.nonce),
    utf8ByteString(input.receiverId),
    input.blockHash,
    u32(input.actions.length),
    ...input.actions,
  );
  const hash = sha256(transaction);
  const signature = ed25519.sign(hash, relayer.seed);
  return { hash: base58.encode(hash), bytes: concatBytes(transaction, ED25519, signature) };
}

/**
 * The Borsh encoding of a `DelegateAction` (without the NEP-461 prefix, as
 * it sits in a `SignedDelegateAction`): from `senderId`, whose ed25519 key
 * is `publicKey`, to `receiverId`, holding `actions`. It needs `nonce`
 * above the key's and lands up to block `maxBlockHeight`.
 */
export function encodeDelegateAction(input: {
  senderId: string;
  receiverId: string;
  actions: NearAction[];
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: Uint8Array;
}): Uint8Array {
  return concatBytes(
    utf8ByteString(input.senderId),
    utf8ByteString(input.receiverId),
    u32(input.actions.length),
    ...input.actions,
    u64(input.nonce),
    u64(input.maxBlockHeight),
    ED25519,
    input.publicKey,
  );
}

/**
 * What the sender's key signs for a delegate action (NEP-461): SHA-256 of
 * the NEP-366 prefix and the Borsh-encoded action, 32 bytes.
 */
export function nearDelegatePayloadHash(delegateAction: Uint8Array): Uint8Array {
  return sha256(concatBytes(u32(NEP_366_PREFIX), delegateAction));
}

/** A `SignedDelegateAction` (base64 Borsh): the action, then its ed25519 signature. */
export function signedNearDelegate(delegateAction: Uint8Array, signature: Uint8Array): string {
  return base64.encode(concatBytes(delegateAction, ED25519, signature));
}

/** A function call inside a decoded delegate action. `args` are its raw bytes (JSON for Herald's). */
export type NearFunctionCall = {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
};

/**
 * A `SignedDelegateAction` as `decodeSignedNearDelegate` reads it. `calls`
 * are its actions, each a function call. `delegateAction` is the bytes the
 * signature covers, with `nearDelegatePayloadHash`; `signedBytes` the whole
 * signed delegate action, as relayed.
 */
export type DecodedNearDelegate = {
  senderId: string;
  receiverId: string;
  calls: NearFunctionCall[];
  nonce: bigint;
  maxBlockHeight: bigint;
  /** The sender's ed25519 key, 32 bytes. */
  publicKey: Uint8Array;
  signature: Uint8Array;
  delegateAction: Uint8Array;
  signedBytes: Uint8Array;
};

/** Reads Borsh fields off `bytes`, in order. Throws on running out. */
class BorshReader {
  #offset = 0;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get offset(): number {
    return this.#offset;
  }

  take(n: number): Uint8Array {
    if (this.#offset + n > this.#bytes.length) throw new Error("it ends too early");
    const out = this.#bytes.subarray(this.#offset, this.#offset + n);
    this.#offset += n;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }

  u32(): number {
    return new DataView(this.take(4).slice().buffer).getUint32(0, true);
  }

  u64(): bigint {
    return new DataView(this.take(8).slice().buffer).getBigUint64(0, true);
  }

  u128(): bigint {
    const view = new DataView(this.take(16).slice().buffer);
    return view.getBigUint64(0, true) | (view.getBigUint64(8, true) << 64n);
  }

  byteString(): Uint8Array {
    return this.take(this.u32());
  }

  string(): string {
    return textDecoder.decode(this.byteString());
  }

  get done(): boolean {
    return this.#offset === this.#bytes.length;
  }
}

// More actions than this in one delegate action is never something Herald
// relays; the bound keeps a hostile length from looping long.
const MAX_DECODED_ACTIONS = 16;

/**
 * Decodes a `SignedDelegateAction` (base64 Borsh, as wallets answer
 * `signDelegateActions`) whose actions are all function calls and whose key
 * and signature are ed25519, the only kind Herald relays. Throws, saying
 * why, on anything else. It doesn't check the signature: see
 * `nearDelegateSignatureValid`.
 */
export function decodeSignedNearDelegate(signedDelegateAction: string): DecodedNearDelegate {
  const signedBytes = base64.decode(signedDelegateAction);
  const r = new BorshReader(signedBytes);
  const senderId = r.string();
  const receiverId = r.string();
  const count = r.u32();
  if (count > MAX_DECODED_ACTIONS) throw new Error(`it holds ${count} actions`);
  const calls: NearFunctionCall[] = [];
  for (let i = 0; i < count; i++) {
    const tag = r.u8();
    if (tag !== FUNCTION_CALL_TAG[0]) throw new Error(`action ${i} isn't a function call`);
    calls.push({ methodName: r.string(), args: r.byteString(), gas: r.u64(), deposit: r.u128() });
  }
  const nonce = r.u64();
  const maxBlockHeight = r.u64();
  if (r.u8() !== ED25519[0]) throw new Error("its key isn't ed25519");
  const publicKey = r.take(32).slice();
  const delegateAction = signedBytes.slice(0, r.offset);
  if (r.u8() !== ED25519[0]) throw new Error("its signature isn't ed25519");
  const signature = r.take(64).slice();
  if (!r.done) throw new Error("it has bytes after the signature");
  return {
    senderId,
    receiverId,
    calls,
    nonce,
    maxBlockHeight,
    publicKey,
    signature,
    delegateAction,
    signedBytes,
  };
}

/**
 * Whether a decoded delegate action's signature is its key's over its
 * NEP-461 hash, verified strictly (RFC 8032), as NEAR verifies it.
 */
export function nearDelegateSignatureValid(delegate: DecodedNearDelegate): boolean {
  try {
    return ed25519.verify(
      delegate.signature,
      nearDelegatePayloadHash(delegate.delegateAction),
      delegate.publicKey,
      { zip215: false },
    );
  } catch {
    return false;
  }
}

/** An error a NEAR node answered. `rpcCause` is its `cause.name`, e.g. `INVALID_TRANSACTION`. */
export class NearRpcError extends Error {
  readonly rpcCause: string | undefined;
  readonly info: unknown;

  constructor(message: string, cause: string | undefined, info: unknown) {
    super(message);
    this.name = "NearRpcError";
    this.rpcCause = cause;
    this.info = info;
  }
}

/**
 * A NEAR JSON-RPC endpoint. `call` calls one method (NEAR's methods take
 * object params) and returns its `result`; an error answer rejects with a
 * `NearRpcError`. `name` is how errors name the endpoint (e.g.
 * `"NEAR Testnet RPC"`), never by its URL, which may carry an API key.
 */
export type NearRpc = {
  readonly name: string;
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
};

/**
 * A `NearRpc` to the endpoint at `url`, each call giving up after
 * `timeoutMs`. Errors name the endpoint `name` (e.g. `"NEAR Testnet RPC"`),
 * never the URL, which may carry an API key: an error answer is a
 * `NearRpcError` with the node's cause, a failed request core's
 * `requestFailedError`.
 */
export function nearRpcAt(
  fetchFn: typeof fetch,
  url: string,
  name: string,
  timeoutMs: number,
): NearRpc {
  const call = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const response = await postRpc(
      fetchFn,
      url,
      { jsonrpc: "2.0", id: "herald", method, params },
      `${name} ${method}`,
      AbortSignal.timeout(timeoutMs),
    );
    const body = (await response.json()) as {
      result?: unknown;
      error?: { cause?: { name?: string; info?: unknown }; message?: string };
    };
    if (body.error) {
      const cause = body.error.cause?.name;
      throw new NearRpcError(
        `${name} refused ${method}: ${cause ?? body.error.message ?? "error"}`,
        cause,
        body.error.cause?.info,
      );
    }
    return body.result;
  };
  return { name, call };
}

/** The latest final block's height and hash (base58). */
export async function finalBlock(rpc: NearRpc): Promise<{ height: number; hash: string }> {
  const block = (await rpc.call("block", { finality: "final" })) as {
    header?: { height?: unknown; hash?: unknown };
  } | null;
  const height = block?.header?.height;
  const hash = block?.header?.hash;
  if (typeof height !== "number" || typeof hash !== "string") {
    throw new Error(`${rpc.name} block answered no height and hash`);
  }
  return { height, hash };
}

/**
 * Calls view method `method` on `contract` with JSON `args`, at final
 * finality, and returns its JSON answer. A view that fails inside the
 * contract (the node answers it in `result.error`) rejects too.
 */
export async function callViewFunction(
  rpc: NearRpc,
  contract: string,
  method: string,
  args: object,
): Promise<unknown> {
  const answer = (await rpc.call("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: base64.encode(textEncoder.encode(JSON.stringify(args))),
  })) as { result?: unknown; error?: unknown } | null;
  if (!Array.isArray(answer?.result)) {
    throw new Error(
      `${rpc.name} ${method} on ${contract} failed: ${JSON.stringify(answer?.error ?? null)}`,
    );
  }
  return JSON.parse(textDecoder.decode(Uint8Array.from(answer.result as number[])));
}

/**
 * Whether `accountId` is registered on the NEP-145 contract `token`
 * (`storage_balance_of` isn't null), so it can receive the token.
 */
export async function isStorageRegistered(
  rpc: NearRpc,
  token: string,
  accountId: string,
): Promise<boolean> {
  return (
    (await callViewFunction(rpc, token, "storage_balance_of", { account_id: accountId })) !== null
  );
}

/**
 * `accountId`'s access key `publicKey` (`ed25519:…`) at final finality: its
 * nonce and permission (`"FullAccess"`, or a `{ FunctionCall }` object).
 * Null if the account has no such key or doesn't exist, which nodes answer
 * either as an error or inside the result.
 */
export async function viewAccessKey(
  rpc: NearRpc,
  accountId: string,
  publicKey: string,
): Promise<{ nonce: bigint; permission: unknown } | null> {
  let key: { nonce?: unknown; permission?: unknown; error?: unknown } | null;
  try {
    key = (await rpc.call("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    })) as typeof key;
  } catch (error) {
    if (
      error instanceof NearRpcError &&
      (error.rpcCause === "UNKNOWN_ACCESS_KEY" || error.rpcCause === "UNKNOWN_ACCOUNT")
    ) {
      return null;
    }
    throw error;
  }
  if (typeof key?.error === "string" && /does not exist/i.test(key.error)) return null;
  if (typeof key?.nonce !== "number")
    throw new Error(`${rpc.name} view_access_key answered no nonce`);
  return { nonce: BigInt(key.nonce), permission: key.permission };
}

/**
 * `accountId` at final finality, as `view_account` answers it (its
 * `amount` in yoctoNEAR, its `code_hash`, …); null if it doesn't exist.
 */
export async function viewAccount(
  rpc: NearRpc,
  accountId: string,
): Promise<{ amount?: unknown; code_hash?: unknown } | null> {
  try {
    const account = (await rpc.call("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    })) as { amount?: unknown; code_hash?: unknown; error?: unknown } | null;
    if (typeof account !== "object" || account === null) {
      throw new Error(`${rpc.name} view_account answered without a result`);
    }
    if (account.error !== undefined) {
      throw new Error(`${rpc.name} view_account failed: ${JSON.stringify(account.error)}`);
    }
    return account;
  } catch (error) {
    if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_ACCOUNT") return null;
    throw error;
  }
}

/** A transaction's outcome as `tx` answers it, as far as Herald reads it. */
export type NearOutcome = {
  final_execution_status?: string;
  status?: { Failure?: unknown; SuccessValue?: unknown } | string;
  receipts_outcome?: { outcome?: { executor_id?: string; status?: Record<string, unknown> } }[];
};

/** The failure of a transaction or of one of its receipts, as JSON; null if none failed. */
export function outcomeFailure(outcome: NearOutcome): string | null {
  const status = typeof outcome.status === "object" ? outcome.status : undefined;
  if (status?.Failure !== undefined) return JSON.stringify(status.Failure);
  const failed = (outcome.receipts_outcome ?? []).find(
    (r) => r.outcome?.status?.["Failure"] !== undefined,
  );
  return failed ? JSON.stringify(failed.outcome?.status?.["Failure"]) : null;
}

/**
 * How a relayed `ft_transfer` on `token` ended, from its transaction's
 * outcome, the way the stock `@x402/near` signer reads it: a failed
 * transaction or receipt fails it; otherwise it succeeded if the token
 * contract's receipt has a `SuccessValue`.
 */
export function ftTransferOutcome(outcome: NearOutcome, token: string): NearReceiptStatus {
  const failure = outcomeFailure(outcome);
  if (failure) return { kind: "failure", error: failure };
  const transfer = (outcome.receipts_outcome ?? []).find((r) => r.outcome?.executor_id === token);
  const value = transfer?.outcome?.status?.["SuccessValue"];
  return typeof value === "string"
    ? { kind: "success", value }
    : { kind: "failure", error: "inner_ft_transfer_receipt_not_successful" };
}
