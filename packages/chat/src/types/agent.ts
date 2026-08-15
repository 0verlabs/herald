import type { Agent as CoreAgent } from "@hrld/core";
import { agentSchema as coreAgentSchema } from "@hrld/core";
import { z } from "zod";

export type { AgentId } from "@hrld/core";

/**
 * TEMPORARY — everything below feeds the mock-backed marketplace and dies with
 * the services redesign. The canonical Agent lives in `@hrld/core`; this module
 * only layers mock-only pricing/service shapes on top of it.
 */

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

/** Canonical Agent plus the mock-only, derived `startsFrom` display fee. */
export const agentSchema = coreAgentSchema.extend({
  startsFrom: agentFeeSchema,
});
export type Agent = CoreAgent & { startsFrom: AgentFee };
