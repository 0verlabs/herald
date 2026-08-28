import { z } from "zod";

import { chainSchema } from "./chain";

export const agentSchema = z.object({
  id: z.string(),
  chain: chainSchema,
  agentId: z.number().int().nonnegative(),
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
