import { generateKeyPairSync, randomBytes } from "node:crypto";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readMigrations } from "@herald/db/testing";
import { base58 } from "@scure/base";
import { defineConfig } from "vite-plus";

// Throwaway gas wallets for each test run. Tests never reach a real chain.
function testSolanaKey(): string {
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
          SOLANA_GAS_KEY: testSolanaKey(),
          // Answered by the fake Solana cluster (test/support/network.ts).
          SOLANA_RPC_URL: "https://solana-devnet.rpc.test/",
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
  resolve: { mainFields: ["module", "main"] },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
