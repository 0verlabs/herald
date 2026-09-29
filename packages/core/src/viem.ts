import { zeroGMainnet } from "viem/chains";
import type { EvmChain } from "./chain";

// viem also exports `zeroG` (16600, the deprecated Newton testnet) and
// `zeroGTestnet` (16602); 16661 is the only 0G network Herald targets.
export const viemChainByChain = {
  "0g": zeroGMainnet,
} as const satisfies Record<EvmChain, unknown>;
