import crypto from "node:crypto";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { expect, test } from "vite-plus/test";
import { createRecipientKeyPair, openSealed } from "../src/lib/hpke.ts";

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

// Stands in for Privy: seals a payload to the SPKI public key the CLI advertises.
async function seal(recipientPublicKeySpki: string, plaintext: string) {
  const jwk = crypto
    .createPublicKey({
      key: Buffer.from(recipientPublicKeySpki, "base64"),
      format: "der",
      type: "spki",
    })
    .export({ format: "jwk" });

  // DHKEM(P-256) takes the uncompressed point, which SPKI wraps as x and y.
  const point = Buffer.concat([
    Buffer.of(0x04),
    Buffer.from(jwk.x ?? "", "base64url"),
    Buffer.from(jwk.y ?? "", "base64url"),
  ]);

  const sender = await suite.createSenderContext({
    recipientPublicKey: await suite.kem.deserializePublicKey(new Uint8Array(point).buffer),
  });

  return {
    encapsulatedKey: Buffer.from(sender.enc).toString("base64"),
    ciphertext: Buffer.from(await sender.seal(new TextEncoder().encode(plaintext))).toString(
      "base64",
    ),
  };
}

test("opens a payload sealed to the advertised public key", async () => {
  const recipient = createRecipientKeyPair();
  const authorizationKey = crypto
    .generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    })
    .privateKey.toString("base64");

  const opened = await openSealed(
    recipient.privateKeyPem,
    await seal(recipient.publicKeySpki, authorizationKey),
  );

  expect(opened).toBe(authorizationKey);
});

test("fails to open a payload sealed to a different recipient", async () => {
  const sealed = await seal(createRecipientKeyPair().publicKeySpki, "secret");
  const other = createRecipientKeyPair();

  await expect(openSealed(other.privateKeyPem, sealed)).rejects.toThrow();
});
