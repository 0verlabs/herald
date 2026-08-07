import { z } from "zod";

export const featuredAgentSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  score: z.number().min(0).max(100),
  calls: z.number().nonnegative(),
  position: z.number(),
});
export type FeaturedAgent = z.infer<typeof featuredAgentSchema>;

export const agentHttpServiceSchema = z.object({
  name: z.literal("HTTP"),
  action: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  endpoint: z.string(),
  description: z.string(),
  fee: z.string(),
});
export type AgentHttpService = z.infer<typeof agentHttpServiceSchema>;

export const agentMcpServiceSchema = z.object({
  name: z.literal("MCP"),
  transport: z.enum(["stdio", "sse", "streamable-http"]),
  endpoint: z.string(),
  description: z.string(),
});
export type AgentMcpService = z.infer<typeof agentMcpServiceSchema>;

export const agentServiceSchema = z.union([agentHttpServiceSchema, agentMcpServiceSchema]);
export type AgentService = z.infer<typeof agentServiceSchema>;

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
  id: z.number(),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: agentCategorySchema,
  score: z.number().min(0).max(100),
  calls: z.number().nonnegative(),
  startsFrom: z.number().nullable(),
});
export type Agent = z.infer<typeof agentSchema>;
