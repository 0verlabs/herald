import { defineConfig } from "vite-plus";

// Files Vite+ should neither format nor lint: generated code, vendored agent
// skills, and the research notes (kept byte-for-byte as written).
const ignorePatterns = [
  "**/dist/**",
  "**/.wrangler/**",
  "**/.tanstack/**",
  "**/worker-configuration.d.ts",
  "**/routeTree.gen.ts",
  "packages/db/migrations/**",
  ".agents/**",
  ".claude/**",
  ".kiro/**",
  "docs/**",
  "HACKATHON.md",
  "skills-lock.json",
];

export default defineConfig({
  fmt: {
    ignorePatterns,
  },
  lint: {
    ignorePatterns,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["apps/web/**"],
        plugins: ["react"],
      },
    ],
  },
  test: {
    // apps/web is left out: its Vite config loads @cloudflare/vite-plugin,
    // which breaks Vitest startup (workers-sdk issue #15969). The dashboard
    // UI is not covered by automated tests (see #1, Testing Decisions).
    projects: [
      "packages/*/vite.config.ts",
      // Core's D1- and KV-backed business functions, in the Workers pool.
      "packages/core/vite.workers.config.ts",
      "apps/facilitator/vite.config.ts",
    ],
  },
  run: {
    // Never cache package.json scripts: a cached `deploy` replays its old
    // output and skips the deploy, and cached runs only see allowlisted env
    // vars, so CLOUDFLARE_ENV would not reach them.
    cache: { tasks: true, scripts: false },
  },
});
