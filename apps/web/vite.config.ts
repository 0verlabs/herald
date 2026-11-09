import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// The Wrangler environment (testnet or mainnet) is picked at build time with
// CLOUDFLARE_ENV. `wrangler deploy` then deploys the flattened config the
// build writes, so it takes no `--env` flag.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Share local D1 and KV state with the facilitator's `wrangler dev`.
      persistState: { path: "../../.wrangler/state" },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});
