import { z } from "zod";

export const supportedChains = ["0g", "0g-testnet"] as const;

export const chainSchema = z.enum(supportedChains);
export type Chain = z.infer<typeof chainSchema>;

// EVM chain ids (matches viem's zeroGMainnet/zeroGTestnet).
export const chainIds = {
  "0g": 16661,
  "0g-testnet": 16602,
} as const satisfies Record<Chain, number>;

export function chainFromId(chainId: number) {
  return supportedChains.find((chain) => chainIds[chain] === chainId);
}
