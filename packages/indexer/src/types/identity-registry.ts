import z from "zod";

export const agentZgStorageUriSchema = z.string().startsWith("0g://");
export const agentDataUriSchema = z.string().startsWith("data:application/json;base64,");

export const agentUriSchema = z.union([agentZgStorageUriSchema, agentDataUriSchema]);

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

export const agentRegistrationSchema = z.object({
  agentId: z.number(),
  agentRegistry: z.string(),
});

export const agentRegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string(),
  description: z.string(),
  image: z.url(),
  active: z.boolean(),
  x402Support: z.boolean(),
  tags: z.string().array().optional(),
  supportedTrust: z.string().array().optional(),
  services: agentServiceSchema.array().optional(),
  registrations: agentRegistrationSchema.array().optional(),
});

export type AgentZgStorageUri = z.infer<typeof agentZgStorageUriSchema>;
export type AgentDataUri = z.infer<typeof agentDataUriSchema>;
export type AgentUri = z.infer<typeof agentUriSchema>;
export type AgentRegistrationFile = z.infer<typeof agentRegistrationFileSchema>;
export type AgentApiService = z.infer<typeof agentApiServiceSchema>;
export type AgentMcpService = z.infer<typeof agentMcpServiceSchema>;
export type AgentService = z.infer<typeof agentServiceSchema>;
