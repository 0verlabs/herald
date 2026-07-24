import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    deps: {
      optimizer: {
        // @tanstack/ai depends on CJS-only partial-json; pre-bundle it so the
        // workerd ESM runtime gets synthesized named exports.
        ssr: {
          enabled: true,
          include: ["@tanstack/ai"],
        },
      },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
