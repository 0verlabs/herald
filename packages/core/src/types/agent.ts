import { z } from "zod";

import { chainSchema } from "./chain";

export const onchainAgentIdSchema = z.string();
export type OnchainAgentId = z.infer<typeof onchainAgentIdSchema>;

export const agentIdSchema = z.templateLiteral([chainSchema, ":", onchainAgentIdSchema]);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentSchema = z.object({
  id: agentIdSchema,
  chain: chainSchema,
  onchainAgentId: onchainAgentIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  tags: z.array(z.string()),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
});
export type Agent = z.infer<typeof agentSchema>;
