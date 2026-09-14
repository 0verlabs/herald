import type { CodegenConfig } from "@graphql-codegen/cli";
import { requireEnv } from "./env.ts";

const config: CodegenConfig = {
  schema: {
    [requireEnv("ERC_8183_SUBGRAPH_URL")]: {
      headers: {
        Authorization: `Bearer ${requireEnv("ERC_8183_SUBGRAPH_API_KEY")}`,
      },
    },
  },
  documents: ["src/lib/subgraphs/erc-8183.graphql"],
  ignoreNoDocuments: true,
  generates: {
    "src/lib/subgraphs/erc-8183/index.ts": {
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
