import { z } from "zod";

import { chainSchema } from "./chain";

export const agentIdSchema = z.templateLiteral([chainSchema, ":", z.number()]);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentCategorySchema = z.enum([
  "finance",
  "productivity",
  "developer-tools",
  "writing",
  "research",
  "others",
]);
export type AgentCategory = z.infer<typeof agentCategorySchema>;

export const agentSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: z.array(agentCategorySchema),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
});
export type Agent = z.infer<typeof agentSchema>;
