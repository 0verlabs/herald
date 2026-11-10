import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    // See the comment in that file for why it sits outside this package.
    tsconfig: "../tsconfig.x402-dts.json",
    dts: { generator: "tsgo" },
    // In the workspace, `exports` points at the sources, so the example API
    // and type checks work without building first. Publishing swaps in the
    // built files from `publishConfig.exports`.
    exports: { devExports: true },
    deps: {
      // @herald/core is private, so its code is bundled in rather than
      // depended on. The published output may import nothing but zod and the
      // audited noble/scure crypto packages: no Cloudflare, Drizzle or other
      // workspace packages.
      alwaysBundle: ["@herald/core"],
      onlyBundle: ["@herald/core"],
      onlyImport: ["zod", "@noble/curves", "@noble/hashes", "@scure/base"],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
