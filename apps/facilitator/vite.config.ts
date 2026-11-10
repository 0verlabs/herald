import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readMigrations } from "@herald/db/testing";
import { defineConfig } from "vite-plus";

// Test-only config: the Worker itself runs and deploys with Wrangler, which
// keeps @cloudflare/vite-plugin out of Vitest (workers-sdk #15969). Tests use
// @cloudflare/vitest-plugin because @cloudflare/vitest-pool-workers only
// supports Vitest 4, and Vite+ ships Vitest 5.
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
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
