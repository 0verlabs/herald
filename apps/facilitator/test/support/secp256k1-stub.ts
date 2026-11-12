// Stands in for the `secp256k1` package in tests (see vite.config.ts).
// @x402/near's @near-js/crypto imports it for secp256k1 NEAR keys. Its
// pure-JS fallback `require`s `elliptic`, which the Vitest Workers pool loads
// as an ES namespace without its exports, so importing it fails; Wrangler's
// bundle loads it fine. Tests only use ed25519 NEAR keys.
function unsupported(): never {
  throw new Error("secp256k1 NEAR keys aren't available in facilitator tests");
}

export default {
  publicKeyCreate: unsupported,
  ecdsaSign: unsupported,
  ecdsaVerify: unsupported,
};
