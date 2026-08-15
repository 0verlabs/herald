import type { Chain } from "@hrld/core/types";
import type { Chain as ViemChain } from "viem/chains";
import { zeroGMainnet, zeroGTestnet } from "viem/chains";

import type { ChainConfig } from "../types/chain";
import { env } from "../env";

export const chainConfigs = {
  "0g": {
    name: zeroGMainnet.name,
    network: "evm",
    rpcUrl: env.RPC_URL_0G ?? zeroGMainnet.rpcUrls.default.http[0],
  },
  "0g-testnet": {
    name: zeroGTestnet.name,
    network: "evm",
    rpcUrl: env.RPC_URL_0G_TESTNET ?? zeroGTestnet.rpcUrls.default.http[0],
  },
} as const satisfies Record<Chain, ChainConfig>;

export const viemChains = {
  "0g": zeroGMainnet,
  "0g-testnet": zeroGTestnet,
} as const satisfies Record<Chain, ViemChain>;
