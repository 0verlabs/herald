import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    // See the comment in that file for why it sits outside this package.
    tsconfig: "../tsconfig.x402-dts.json",
    dts: { generator: "tsgo" },
    exports: true,
    deps: {
      // @herald/core is private, so its code is bundled in rather than
      // depended on. The published output may import nothing but zod: no
      // Cloudflare, Drizzle or other workspace packages.
      alwaysBundle: ["@herald/core"],
      onlyBundle: ["@herald/core"],
      onlyImport: ["zod"],
    },
  },
});
