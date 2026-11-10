import type {
  NearAccessKeyReader,
  SignInChallenge,
  SignInSignature,
} from "../../src/server/index.ts";
import { base64 } from "@scure/base";
import { KeyPairEd25519, KeyPairSigner } from "near-api-js";

/** A fresh ed25519 NEAR key pair. */
export function nearKey(): KeyPairEd25519 {
  return KeyPairEd25519.fromRandom();
}

/**
 * Signs a sign-in challenge the way a NEAR wallet does for `signMessage`
 * (NEP-413), with near-api-js as the reference encoder, and returns what the
 * dashboard sends back. `key` defaults to signing with the presented key.
 */
export async function walletSignature(input: {
  accountId: string;
  challenge: SignInChallenge;
  key: KeyPairEd25519;
  /** Present this public key instead of the signing key's. */
  presentedKey?: KeyPairEd25519;
  /** Sign for this recipient instead of the challenge's. */
  recipient?: string;
}): Promise<SignInSignature> {
  const { challenge } = input;
  const signed = await new KeyPairSigner(input.key).signNep413Message(input.accountId, {
    message: challenge.message,
    recipient: input.recipient ?? challenge.recipient,
    nonce: base64.decode(challenge.nonce),
  });
  return {
    accountId: input.accountId,
    publicKey: (input.presentedKey ?? input.key).getPublicKey().toString(),
    signature: base64.encode(signed.signature),
    nonce: challenge.nonce,
  };
}

type Permission = Awaited<ReturnType<NearAccessKeyReader>>;

/**
 * A fake NEAR RPC that knows the access keys of a few accounts, by account
 * id and public key. Any other key doesn't exist.
 */
export function fakeNearAccounts(
  accounts: Record<string, Array<[KeyPairEd25519, NonNullable<Permission>]>>,
): NearAccessKeyReader {
  return async ({ accountId, publicKey }) => {
    const match = accounts[accountId]?.find(([key]) => key.getPublicKey().toString() === publicKey);
    return match ? match[1] : null;
  };
}
