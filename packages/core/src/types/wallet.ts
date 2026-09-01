import { z } from "zod";

import type { Network } from "./network";

export const createWalletSchema = <TNetwork extends Network>(network: TNetwork) =>
  z.object({
    id: z.string(),
    owner: z.string(),
    address: z.string(),
    network: z.literal(network),
  });

export const evmWalletSchema = createWalletSchema("evm");
export const solanaWalletSchema = createWalletSchema("solana");

export const walletSchema = z.discriminatedUnion("network", [evmWalletSchema, solanaWalletSchema]);

export type EvmWallet = z.infer<typeof evmWalletSchema>;
export type SolanaWallet = z.infer<typeof solanaWalletSchema>;

export type Wallet = z.infer<typeof walletSchema>;
