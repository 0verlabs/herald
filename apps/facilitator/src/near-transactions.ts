import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";

// Borsh encoding of the NEAR transactions Herald's relayer signs, written
// out instead of pulling in a NEAR library: a transaction is a handful of
// fixed fields, and the Buyer's signed delegate action goes in as the bytes
// it arrived as, so nothing of it is decoded and re-encoded.
// https://nomicon.io/RuntimeSpec/Transactions

const textEncoder = new TextEncoder();

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

function byteString(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32(bytes.length), bytes);
}

function string(value: string): Uint8Array {
  return byteString(textEncoder.encode(value));
}

// `PublicKey` and `Signature` start with their key type; 0 is ed25519.
const ED25519 = new Uint8Array([0]);

// `Action` variant tags.
const FUNCTION_CALL_TAG = new Uint8Array([2]);
const TRANSFER_TAG = new Uint8Array([3]);
const DELEGATE_TAG = new Uint8Array([8]);

/** A Borsh-encoded `Action`, for `signedRelayerTransaction`. */
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
    string(input.methodName),
    byteString(textEncoder.encode(JSON.stringify(input.args))),
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
    string(relayer.accountId),
    ED25519,
    relayer.publicKey,
    u64(input.nonce),
    string(input.receiverId),
    input.blockHash,
    u32(input.actions.length),
    ...input.actions,
  );
  const hash = sha256(transaction);
  const signature = ed25519.sign(hash, relayer.seed);
  return { hash: base58.encode(hash), bytes: concatBytes(transaction, ED25519, signature) };
}
