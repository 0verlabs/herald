import crypto from "node:crypto";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

// Privy fixes this suite for the wallet authentication response.
const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

export interface Sealed {
  encapsulatedKey: string;
  ciphertext: string;
}

// The sender encrypts to this public key, so only the process holding the
// private key can open the result.
export function createRecipientKeyPair() {
  const keyPair = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  return { privateKeyPem: keyPair.privateKey, publicKeySpki: keyPair.publicKey.toString("base64") };
}

export async function openSealed(privateKeyPem: string, sealed: Sealed): Promise<string> {
  // The KEM wants the raw 32-byte scalar, which a JWK export exposes as `d`.
  const jwk = crypto.createPrivateKey(privateKeyPem).export({ format: "jwk" });
  const recipientKey = await suite.kem.deserializePrivateKey(
    toArrayBuffer(Buffer.from(jwk.d ?? "", "base64url")),
  );

  const context = await suite.createRecipientContext({
    recipientKey,
    enc: toArrayBuffer(Buffer.from(sealed.encapsulatedKey, "base64")),
  });

  return new TextDecoder().decode(
    await context.open(toArrayBuffer(Buffer.from(sealed.ciphertext, "base64"))),
  );
}

// Node pools Buffer memory, so `buffer.buffer` can be larger than the view; copy
// into a tight ArrayBuffer before handing bytes to HPKE.
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}
