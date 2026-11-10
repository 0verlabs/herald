// The business functions in src/server, tested against real D1 and KV in the
// Cloudflare Vitest pool (Seam 3). Their outside dependencies (NEAR RPC,
// chains) are fakes the tests pass in. vite.config.ts runs the pure tests in
// Node.js.
//
// @cloudflare/vitest-plugin, not @cloudflare/vitest-pool-workers: the pool
// package only supports Vitest 4, and Vite+ ships Vitest 5.
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readMigrations } from "@herald/db/testing";
import { defineConfig } from "vite-plus";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readMigrations() },
      },
    }),
  ],
  test: {
    name: "@herald/core (workers)",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
