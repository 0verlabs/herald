import z from "zod";

export const agentUriSchema = z.string().startsWith("data:application/json;base64,");

export const agentApiEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  path: z.string(),
  fee: z.number(),
});

export const agentApiServiceSchema = z.object({
  name: z.literal("API"),
  baseUrl: z.url(),
  version: z.string(),
  endpoints: z.array(agentApiEndpointSchema),
});

export const agentMcpCapabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  fee: z.number(),
});

export const agentMcpServiceSchema = z.object({
  name: z.literal("MCP"),
  endpoint: z.url(),
  version: z.string(),
  tools: z.array(agentMcpCapabilitySchema),
  prompts: z.array(agentMcpCapabilitySchema),
  resources: z.array(agentMcpCapabilitySchema),
});

export const agentServiceSchema = z.union([agentApiServiceSchema, agentMcpServiceSchema]);

export const agentRegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string(),
  description: z.string(),
  image: z.url(),
  services: z.array(agentServiceSchema),
  tags: z.array(z.string()).optional(),
  x402Support: z.boolean(),
  supportedTrust: z.array(z.string()).optional(),
});

export type AgentUri = z.infer<typeof agentUriSchema>;
export type AgentApiService = z.infer<typeof agentApiServiceSchema>;
export type AgentMcpService = z.infer<typeof agentMcpServiceSchema>;
export type AgentService = z.infer<typeof agentServiceSchema>;
export type AgentRegistrationFile = z.infer<typeof agentRegistrationFileSchema>;
