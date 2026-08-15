import { zeroGMainnet, zeroGTestnet } from "viem/chains";

import type { ChainTokenConfig } from "../types/token";

export const tokenConfigs = {
  "0g": {
    native: zeroGMainnet.nativeCurrency,
    usdc: {
      address: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e",
      name: "Bridged USDC",
      symbol: "USDC.e",
      decimals: 6,
    },
  },
  "0g-testnet": {
    native: zeroGTestnet.nativeCurrency,
    usdc: undefined,
  },
} as const satisfies ChainTokenConfig;
