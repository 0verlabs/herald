import type { CodegenConfig } from "@graphql-codegen/cli";
import { requireEnv } from "./env.js";

const config: CodegenConfig = {
  schema: {
    [requireEnv("ERC_8004_SUBGRAPH_URL")]: {
      headers: {
        Authorization: `Bearer ${requireEnv("THE_GRAPH_SUBGRAPH_API_KEY")}`,
      },
    },
  },
  documents: ["src/lib/subgraphs/erc-8004.graphql"],
  ignoreNoDocuments: true,
  generates: {
    ".generated/erc-8004/index.ts": {
      plugins: ["typescript-operations", "typescript-graphql-request"],
      config: {
        scalars: {
          BigInt: "string",
          Bytes: "string",
          Timestamp: "string",
        },
      },
    },
  },
};

export default config;
