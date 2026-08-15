import { z } from "zod";

import { chainSchema } from "./chain";

export const agentIdSchema = z.templateLiteral([chainSchema, ":", z.number()]);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  // Free-text tags self-declared in the agent's registration file.
  tags: z.array(z.string()),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
});
export type Agent = z.infer<typeof agentSchema>;
