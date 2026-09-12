import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [cloudflare()],
  run: {
    tasks: {
      // vpr strips undeclared env vars from task processes; the codegen
      // configs read these (with wrangler.jsonc fallbacks for the URLs).
      "codegen:erc8004": {
        command: "graphql-codegen --config codegen/erc-8004.ts",
        env: ["ERC_8004_SUBGRAPH_URL"],
        untrackedEnv: ["THE_GRAPH_SUBGRAPH_API_KEY"],
      },
      "codegen:erc8183": {
        command: "graphql-codegen --config codegen/erc-8183.ts",
        env: ["ERC_8183_SUBGRAPH_URL"],
        untrackedEnv: ["THE_GRAPH_SUBGRAPH_API_KEY"],
      },
      codegen: {
        command: "true",
        cache: false,
        dependsOn: ["codegen:erc8004", "codegen:erc8183"],
      },
    },
  },
});
