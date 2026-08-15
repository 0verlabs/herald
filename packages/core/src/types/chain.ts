import { z } from "zod";

export const supportedChains = ["0g", "0g-testnet"] as const;

export const chainSchema = z.enum(supportedChains);
export type Chain = z.infer<typeof chainSchema>;
