import { generateKeyPairSync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readMigrations } from "@herald/db/testing";
import { base58 } from "@scure/base";
import { defineConfig } from "vite-plus";

// Throwaway gas wallets for each test run. Tests never reach a real chain.
// A base58 64-byte ed25519 secret key (seed, then public key): Solana's
// format, and near-cli's after an `ed25519:` prefix.
function testEd25519Key(): string {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  return base58.encode(
    Buffer.concat([Buffer.from(jwk.d ?? "", "base64url"), Buffer.from(jwk.x ?? "", "base64url")]),
  );
}

// Test-only config: the Worker itself runs and deploys with Wrangler, which
// keeps @cloudflare/vite-plugin out of Vitest (workers-sdk #15969). Tests use
// @cloudflare/vitest-plugin because @cloudflare/vitest-pool-workers only
// supports Vitest 4, and Vite+ ships Vitest 5.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readMigrations(),
          EVM_GAS_KEY: `0x${randomBytes(32).toString("hex")}`,
          SOLANA_GAS_KEY: testEd25519Key(),
          NEAR_RELAYER_KEY: `ed25519:${testEd25519Key()}`,
          // Answered by the fake chains and NEAR RPC in test/support/network.ts.
          BASE_RPC_URL: "https://base-sepolia.rpc.test/",
          SOLANA_RPC_URL: "https://solana-devnet.rpc.test/",
          ARBITRUM_RPC_URL: "https://arbitrum-sepolia.rpc.test/",
          NEAR_RPC_URL: "https://near-testnet.rpc.test/",
          // Short, so the settlement_pending tests don't wait 30 s.
          SETTLE_RECEIPT_TIMEOUT_MS: "1500",
        },
      },
    }),
  ],
  // Resolve packages the way Wrangler bundles the Worker. With the default
  // `browser` main field, Vite follows @solana/*'s package.json `browser`
  // map to their browser builds, which refuse to sign or hash outside a
  // browser secure context (workerd has no `isSecureContext`). Wrangler picks
  // their `workerd` builds, which don't check.
  //
  // `secp256k1` is stubbed: see test/support/secp256k1-stub.ts.
  resolve: {
    mainFields: ["module", "main"],
    alias: {
      secp256k1: fileURLToPath(new URL("./test/support/secp256k1-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
