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

export const agentOfferServiceSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  fee: agentFeeSchema,
});

export const agentServiceSchema = z.union([agentOfferServiceSchema]);
export type AgentService = z.infer<typeof agentServiceSchema>;

export const agentSchema = z.object({
  id: agentIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: agentCategorySchema,
  score: z.number().min(0).max(100),
  calls: z.number().nonnegative(),
  startsFrom: agentFeeSchema,
});
export type Agent = z.infer<typeof agentSchema>;
