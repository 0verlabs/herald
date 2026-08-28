import { z } from "zod";

import { chainSchema } from "./chain";

export const agentOnchainId = z.number().int().nonnegative();

export const agentIdCodec = z.codec(
  z.templateLiteral([chainSchema, "_", agentOnchainId]),
  z.object({
    chain: chainSchema,
    agentId: agentOnchainId,
  }),
  {
    encode: ({ chain, agentId }) => `${chain}_${agentId}` as const,
    decode: (str) => {
      const [chainStr, agentIdStr] = str.split("_");

      const chain = chainSchema.parse(chainStr);
      const agentId = agentOnchainId.parse(agentIdStr);

      return {
        chain,
        agentId,
      };
    },
  }
);

export const agentIdSchema = agentIdCodec.in;

export const agentSchema = z.object({
  id: agentIdSchema,
  chain: chainSchema,
  onchainId: agentOnchainId,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: z.string(),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
  wallet: z.string(),
  owner: z.string(),
  active: z.boolean(),
});

export type Agent = z.infer<typeof agentSchema>;
