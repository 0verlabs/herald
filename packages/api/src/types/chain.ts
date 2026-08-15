import { networkSchema } from "@hrld/core/types";
import { z } from "zod";

export const chainConfigSchema = z.object({
  name: z.string(),
  network: networkSchema,
  rpcUrl: z.string(),
});
export type ChainConfig = z.infer<typeof chainConfigSchema>;
