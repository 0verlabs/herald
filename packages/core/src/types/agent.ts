import { z } from "zod";

import { chainSchema } from "./chain";

export const agentSchema = z.object({
  id: z.string(),
  chain: chainSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: z.string(),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
  wallet: z.string(),
  owner: z.string(),
});

export const agentApiServiceSchema = z.object({
  name: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  endpoint: z.string(),
  version: z.string(),
  description: z.string(),
});

export const agentMcpServiceSchema = z.object({
  name: z.literal("MCP"),
  endpoint: z.string(),
  version: z.string(),
  mcpTools: z.string().array().optional(),
  mcpResources: z.string().array().optional(),
  mcpPrompts: z.string().array().optional(),
  capabilities: z.string().array().optional(),
});

export const agentServiceSchema = z.union([agentApiServiceSchema, agentMcpServiceSchema]);

export type Agent = z.infer<typeof agentSchema>;
export type AgentApiService = z.infer<typeof agentApiServiceSchema>;
export type AgentMcpService = z.infer<typeof agentMcpServiceSchema>;
export type AgentService = z.infer<typeof agentServiceSchema>;
