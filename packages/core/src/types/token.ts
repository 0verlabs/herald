import { z } from "zod";

export const supportedTokens = ["native", "usdc"] as const;

export const tokenSchema = z.enum(supportedTokens);
export type Token = z.infer<typeof tokenSchema>;
