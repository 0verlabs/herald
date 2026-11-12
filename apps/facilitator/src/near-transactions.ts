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

function string(value: string): Uint8Array {
  const bytes = textEncoder.encode(value);
  return concatBytes(u32(bytes.length), bytes);
}

// `PublicKey` and `Signature` start with their key type; 0 is ed25519.
const ED25519 = new Uint8Array([0]);

// The `Action::Delegate` variant.
const DELEGATE_ACTION_TAG = new Uint8Array([8]);

/** A signed relayer transaction, ready for `send_tx`, and its hash. */
export type SignedNearTransaction = {
  /** base58 of the SHA-256 of the transaction: what NEAR calls its hash. */
  hash: string;
  /** The Borsh `SignedTransaction`, base64 for `send_tx`'s `signed_tx_base64`. */
  bytes: Uint8Array;
};

/**
 * Builds and signs the relayer transaction that relays a signed delegate
 * action (NEP-366): from the relayer to the delegate's sender, holding one
 * `Delegate` action whose payload is `signedDelegate`, the Borsh
 * `SignedDelegateAction` as the Buyer signed it. `blockHash` (32 bytes) is a
 * recent block, and `nonce` must be above the relayer key's.
 */
export function signedDelegateTransaction(input: {
  relayer: { accountId: string; publicKey: Uint8Array; seed: Uint8Array };
  receiverId: string;
  nonce: bigint;
  blockHash: Uint8Array;
  signedDelegate: Uint8Array;
}): SignedNearTransaction {
  const { relayer } = input;
  const transaction = concatBytes(
    string(relayer.accountId),
    ED25519,
    relayer.publicKey,
    u64(input.nonce),
    string(input.receiverId),
    input.blockHash,
    u32(1),
    DELEGATE_ACTION_TAG,
    input.signedDelegate,
  );
  const hash = sha256(transaction);
  const signature = ed25519.sign(hash, relayer.seed);
  return { hash: base58.encode(hash), bytes: concatBytes(transaction, ED25519, signature) };
}
