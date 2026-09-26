import type { Chain, Network } from "@hrld/core";

// CLI-facing display names. Kept separate from viem's chain configs, which
// name chains for RPC/wallet purposes, not for how Herald wants them read.
export const chainDisplayName = {
  "0g": "0G",
  solana: "Solana",
} as const satisfies Record<Chain, string>;

export const networkDisplayName = {
  evm: "EVM",
  svm: "SVM",
} as const satisfies Record<Network, string>;
