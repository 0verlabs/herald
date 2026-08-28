import { z } from "zod";

import { createEventSchema } from "./contract-event";

export const identityRegistryRegisteredEventSchema = createEventSchema(
  "IdentityRegistry:Registered",
  z.object({
    agentId: z.number(),
    agentUri: z.string(),
    owner: z.string(),
  })
);
export const identityRegistryUriUpdatedEventSchema = createEventSchema(
  "IdentityRegistry:URIUpdated",
  z.object({
    agentId: z.number(),
    newUri: z.string(),
    updatedBy: z.string(),
  })
);
export const identityRegistryMetadataSetEventSchema = createEventSchema(
  "IdentityRegistry:MetadataSet",
  z.object({
    agentId: z.number(),
    indexedMetadataKey: z.string(),
    metadataKey: z.string(),
    metadataValue: z.string(),
  })
);
export const identityRegistryTransferEventSchema = createEventSchema(
  "IdentityRegistry:Transfer",
  z.object({
    from: z.string(),
    to: z.string(),
    tokenId: z.number(),
  })
);

export const identityRegistryEventSchema = z.union([
  identityRegistryRegisteredEventSchema,
  identityRegistryUriUpdatedEventSchema,
  identityRegistryMetadataSetEventSchema,
  identityRegistryTransferEventSchema,
]);

export const reputationRegistryNewFeedbackEventSchema = createEventSchema(
  "ReputationRegistry:NewFeedback",
  z.object({})
);

export const reputationRegistryEventSchema = z.union([reputationRegistryNewFeedbackEventSchema]);

export const registryEventSchema = z.union([
  identityRegistryEventSchema,
  reputationRegistryEventSchema,
]);

export const agentJsonUriSchema = z.templateLiteral(["data:application/json,", z.string()]);
export const agentBase64JsonUriSchema = z.templateLiteral([
  "data:application/json;base64,",
  z.string(),
]);

export const agentUriSchema = z.union([agentJsonUriSchema, agentBase64JsonUriSchema]);

export const agentJobServiceSchema = z.object({
  name: z.literal("JOB"),
  title: z.string(),
  description: z.string(),
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
  capabilities: z.enum(["tools", "resources", "prompts"]).array().optional(),
});

export const agentServiceSchema = z.union([
  agentJobServiceSchema,
  agentApiServiceSchema,
  agentMcpServiceSchema,
]);

export const agentRegistrationSchema = z.object({
  agentId: z.number(),
  agentRegistry: z.templateLiteral([z.string(), ":", z.string(), ":", z.string()]), // {namespace}:{chainId}:{identityRegistry}
});

export const agentRegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string(),
  description: z.string(),
  image: z.url(),

  services: agentServiceSchema.array().optional(),
  registrations: agentRegistrationSchema.array().optional(),

  active: z.boolean(),
  x402Support: z.boolean(),
  tags: z.string().array().optional(),
  supportedTrust: z.string().array().optional(),
});

export const resolveAgentRegistrationFileFromUri = async (uri: string) => {
  const agentUriParsed = agentUriSchema.safeParse(uri);
  if (!agentUriParsed.success) return null;

  const response = await fetch(agentUriParsed.data);
  if (!response.ok) return null;

  const json = await response.json().catch(() => ({}));

  const parsed = agentRegistrationFileSchema.safeParse(json);
  if (!parsed.success) return null;

  return parsed.data;
};
