import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, bytesToNumberBE, bytesToNumberLE } from "@noble/curves/utils.js";
import { keccak_256, sha3_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import type {
  EvmAddress,
  HeraldEnv,
  NearAccountId,
  NearImplicitAccount,
  SolanaAddress,
} from "./schemas.ts";

/**
 * NEAR's MPC signer contract per Herald environment, and the root public keys of
 * its signing domains, pinned so Receiving Addresses derive offline. A
 * root-key change would change every Receiving Address, so
 * `checkMpcRootKeys` compares these with the live contract.
 */
export const mpcSigners = {
  mainnet: {
    contractId: "v1.signer",
    rootKeys: {
      secp256k1:
        "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
      ed25519: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
    },
  },
  testnet: {
    contractId: "v1.signer-prod.testnet",
    rootKeys: {
      secp256k1:
        "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
      ed25519: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
    },
  },
} as const satisfies Record<
  HeraldEnv,
  { contractId: string; rootKeys: { secp256k1: string; ed25519: string } }
>;

/**
 * The signing domain of each curve on the MPC contract (`domain_id`), and the
 * fixed derivation path Herald uses for it. One EVM address serves every EVM
 * network. Changing a path or curve changes every Provider's Receiving
 * Address on that kind (ADR-0009 for NEAR).
 */
export const receivingAddressPaths = {
  evm: { path: "ethereum-1", domainId: 0, curve: "secp256k1" },
  solana: { path: "solana-1", domainId: 1, curve: "ed25519" },
  near: { path: "near-1", domainId: 1, curve: "ed25519" },
} as const;

export type ReceivingAddresses = {
  evm: EvmAddress;
  solana: SolanaAddress;
  near: NearImplicitAccount;
};

/**
 * Derives a Provider Account's Receiving Addresses offline, the same way the
 * MPC contract's `derived_public_key` does (near/mpc `kdf.rs`).
 */
export function deriveReceivingAddresses(
  providerAccount: NearAccountId,
  env: HeraldEnv,
): ReceivingAddresses {
  const { rootKeys } = mpcSigners[env];
  return {
    evm: deriveEvmAddress(
      rootKeys.secp256k1,
      tweak(providerAccount, receivingAddressPaths.evm.path),
    ),
    solana: base58.encode(
      deriveEd25519Key(rootKeys.ed25519, tweak(providerAccount, receivingAddressPaths.solana.path)),
    ),
    near: bytesToHex(
      deriveEd25519Key(rootKeys.ed25519, tweak(providerAccount, receivingAddressPaths.near.path)),
    ),
  };
}

function tweak(predecessor: string, path: string): Uint8Array {
  return sha3_256(
    new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`),
  );
}

// NEAR encodes secp256k1 keys as base58 of the 64-byte uncompressed point
// without the 0x04 prefix.
function deriveEvmAddress(rootKey: string, tweakBytes: Uint8Array): EvmAddress {
  const root = secp256k1.Point.fromHex(`04${bytesToHex(decodeNearKey(rootKey, "secp256k1"))}`);
  const scalar = bytesToNumberBE(tweakBytes);
  if (scalar === 0n || scalar >= secp256k1.Point.Fn.ORDER) {
    throw new Error("Derivation tweak is not a valid secp256k1 scalar");
  }
  const derived = secp256k1.Point.BASE.multiply(scalar).add(root).toBytes(false).subarray(1);
  return `0x${bytesToHex(keccak_256(derived).subarray(-20))}`;
}

// ed25519 reads the tweak little-endian, reduced mod the group order. A
// Solana address is the derived key in base58; a NEAR implicit account is
// the same key in lowercase hex.
function deriveEd25519Key(rootKey: string, tweakBytes: Uint8Array): Uint8Array {
  const root = ed25519.Point.fromBytes(decodeNearKey(rootKey, "ed25519"));
  const scalar = bytesToNumberLE(tweakBytes) % ed25519.Point.Fn.ORDER;
  return root.add(ed25519.Point.BASE.multiply(scalar)).toBytes();
}

function decodeNearKey(key: string, curve: "secp256k1" | "ed25519"): Uint8Array {
  const prefix = `${curve}:`;
  if (!key.startsWith(prefix)) throw new Error(`Expected a ${curve} key, got ${key}`);
  return base58.decode(key.slice(prefix.length));
}
