import { z } from "zod";

export const agentIdSchema = z.number();
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

/** null = free. Assumed USDC — matches Agent.startsFrom and <UsdcLogo> in agent-card.tsx. */
export const agentFeeSchema = z.number().nonnegative().nullable();
export type AgentFee = z.infer<typeof agentFeeSchema>;

export const agentServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["mcpTools", "mcpPrompts", "mcpResources"]),
  action: z.string(),
  description: z.string(),
  fee: agentFeeSchema,
});
export type AgentService = z.infer<typeof agentServiceSchema>;

export const agentSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: agentCategorySchema,
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
  startsFrom: agentFeeSchema,
});
export type Agent = z.infer<typeof agentSchema>;
