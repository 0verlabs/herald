import type { EvmChain, Network } from "@hrld/core";

// The CLI operates on 0G only for now. When another EVM chain lands, add it to
// the enum in @hrld/core, reintroduce a `--chain` option on each command, and
// thread the parsed value through — every helper already takes the chain as a
// parameter.
export const activeChain = "0g" satisfies EvmChain;

// CLI-facing display names. Kept separate from viem's chain configs, which
// name chains for RPC/wallet purposes, not for how Herald wants them read.
export const chainDisplayName = {
  "0g": "0G",
} as const satisfies Record<EvmChain, string>;

export const networkDisplayName = {
  evm: "EVM",
  svm: "SVM",
} as const satisfies Record<Network, string>;
