import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readMigrations } from "@herald/db/testing";
import { defineConfig } from "vite-plus";

// Test-only config: the Worker itself runs and deploys with Wrangler.
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
