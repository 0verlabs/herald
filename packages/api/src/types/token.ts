import { chainSchema } from "@hrld/core/types";
import { z } from "zod";

export const nativeTokenConfigSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number(),
});
export type NativeTokenConfig = z.infer<typeof nativeTokenConfigSchema>;

export const tokenConfigSchema = nativeTokenConfigSchema.extend({
  address: z.string(),
});
export type TokenConfig = z.infer<typeof tokenConfigSchema>;

export const chainTokenConfigSchema = z.record(
  chainSchema,
  z.union([
    z.object({
      native: nativeTokenConfigSchema,
    }),
    z.record(z.string(), tokenConfigSchema.optional()),
  ])
);
export type ChainTokenConfig = z.infer<typeof chainTokenConfigSchema>;
