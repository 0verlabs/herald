import { z } from "zod";

export const supportedNetworks = ["evm", "solana"] as const;

export const networkSchema = z.enum(supportedNetworks);
export type Network = z.infer<typeof networkSchema>;
