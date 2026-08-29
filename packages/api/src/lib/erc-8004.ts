import { z } from "zod";

import { createEventSchema } from "./contract-event";

export const erc8004IdentityRegistryRegisteredEventSchema = createEventSchema(
  "IdentityRegistry:Registered",
  z.object({
    agentId: z.number(),
    agentUri: z.string(),
    owner: z.string(),
  })
);
export const erc8004IdentityRegistryUriUpdatedEventSchema = createEventSchema(
  "IdentityRegistry:URIUpdated",
  z.object({
    agentId: z.number(),
    newUri: z.string(),
    updatedBy: z.string(),
  })
);
export const erc8004IdentityRegistryMetadataSetEventSchema = createEventSchema(
  "IdentityRegistry:MetadataSet",
  z.object({
    agentId: z.number(),
    indexedMetadataKey: z.string(),
    metadataKey: z.string(),
    metadataValue: z.string(),
  })
);
export const erc8004IdentityRegistryTransferEventSchema = createEventSchema(
  "IdentityRegistry:Transfer",
  z.object({
    from: z.string(),
    to: z.string(),
    tokenId: z.number(),
  })
);

export const erc8004IdentityRegistryEventSchema = z.union([
  erc8004IdentityRegistryRegisteredEventSchema,
  erc8004IdentityRegistryUriUpdatedEventSchema,
  erc8004IdentityRegistryMetadataSetEventSchema,
  erc8004IdentityRegistryTransferEventSchema,
]);

export const erc8004ReputationRegistryNewFeedbackEventSchema = createEventSchema(
  "ReputationRegistry:NewFeedback",
  z.object({
    agentId: z.number(),
    clientAddress: z.string(),
    feedbackIndex: z.number(),
    value: z.number(),
    valueDecimals: z.number().int().min(0).max(18),
    indexedTag1: z.string(),
    tag1: z.string(),
    tag2: z.string(),
    endpoint: z.string(),
    feedbackURI: z.string(),
    feedbackHash: z.string(),
  })
);

export const erc8004ReputationRegistryFeedbackRevokedEventSchema = createEventSchema(
  "ReputationRegistry:FeedbackRevoked",
  z.object({
    agentId: z.number(),
    clientAddress: z.string(),
    feedbackIndex: z.number(),
  })
);

export const erc8004ReputationRegistryResponseAppendedEventSchema = createEventSchema(
  "ReputationRegistry:ResponseAppended",
  z.object({
    agentId: z.number(),
    clientAddress: z.string(),
    feedbackIndex: z.number(),
    responder: z.string(),
    responseURI: z.string(),
    responseHash: z.string(),
  })
);

export const erc8004ReputationRegistryEventSchema = z.union([
  erc8004ReputationRegistryNewFeedbackEventSchema,
  erc8004ReputationRegistryFeedbackRevokedEventSchema,
  erc8004ReputationRegistryResponseAppendedEventSchema,
]);

export const erc8004RegistryEventSchema = z.union([
  erc8004IdentityRegistryEventSchema,
  erc8004ReputationRegistryEventSchema,
]);

export const erc8004AgentJsonUriSchema = z.templateLiteral(["data:application/json,", z.string()]);
export const erc8004AgentBase64JsonUriSchema = z.templateLiteral([
  "data:application/json;base64,",
  z.string(),
]);

export const erc8004AgentUriSchema = z.union([
  erc8004AgentJsonUriSchema,
  erc8004AgentBase64JsonUriSchema,
]);

export const erc8004AgentJobServiceSchema = z.object({
  name: z.literal("JOB"),
  title: z.string(),
  description: z.string(),
});

export const erc8004AgentApiServiceSchema = z.object({
  name: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  endpoint: z.string(),
  version: z.string(),
  description: z.string(),
});

export const erc8004AgentMcpServiceSchema = z.object({
  name: z.literal("MCP"),
  endpoint: z.string(),
  version: z.string(),
  mcpTools: z.string().array().optional(),
  mcpResources: z.string().array().optional(),
  mcpPrompts: z.string().array().optional(),
  capabilities: z.enum(["tools", "resources", "prompts"]).array().optional(),
});

export const erc8004AgentServiceSchema = z.union([
  erc8004AgentJobServiceSchema,
  erc8004AgentApiServiceSchema,
  erc8004AgentMcpServiceSchema,
]);

export const erc8004AgentRegistrationSchema = z.object({
  agentId: z.number(),
  agentRegistry: z.templateLiteral([z.string(), ":", z.string(), ":", z.string()]), // {namespace}:{chainId}:{identityRegistry}
});

export const erc8004AgentRegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string(),
  description: z.string(),
  image: z.url(),

  services: erc8004AgentServiceSchema.array().optional(),
  registrations: erc8004AgentRegistrationSchema.array().optional(),

  active: z.boolean(),
  x402Support: z.boolean(),
  tags: z.string().array().optional(),
  supportedTrust: z.string().array().optional(),
});

export const erc8004FeedbackFileProofOfPaymentSchema = z.object({
  fromAddress: z.string(),
  toAddress: z.string(),
  chainId: z.union([z.string(), z.number()]).transform(String),
  txHash: z.string(),
  amount: z.string().optional(),
  currency: z.string().optional(),
});

export const erc8004FeedbackFileSchema = z.object({
  reasoning: z.string().optional(),
  proofOfPayment: erc8004FeedbackFileProofOfPaymentSchema.optional(),
});

export type Erc8004IdentityRegistryRegisteredEvent = z.infer<
  typeof erc8004IdentityRegistryRegisteredEventSchema
>;
export type Erc8004IdentityRegistryUriUpdatedEvent = z.infer<
  typeof erc8004IdentityRegistryUriUpdatedEventSchema
>;
export type Erc8004IdentityRegistryMetadataSetEvent = z.infer<
  typeof erc8004IdentityRegistryMetadataSetEventSchema
>;
export type Erc8004IdentityRegistryTransferEvent = z.infer<
  typeof erc8004IdentityRegistryTransferEventSchema
>;

export type Erc8004IdentityRegistryEvent = z.infer<typeof erc8004IdentityRegistryEventSchema>;

export type Erc8004ReputationRegistryNewFeedbackEvent = z.infer<
  typeof erc8004ReputationRegistryNewFeedbackEventSchema
>;
export type Erc8004ReputationRegistryFeedbackRevokedEvent = z.infer<
  typeof erc8004ReputationRegistryFeedbackRevokedEventSchema
>;
export type Erc8004ReputationRegistryResponseAppendedEvent = z.infer<
  typeof erc8004ReputationRegistryResponseAppendedEventSchema
>;

export type Erc8004ReputationRegistryEvent = z.infer<typeof erc8004ReputationRegistryEventSchema>;

export type Erc8004RegistryEvent = z.infer<typeof erc8004RegistryEventSchema>;

export type Erc8004AgentJsonUri = z.infer<typeof erc8004AgentJsonUriSchema>;
export type Erc8004AgentBase64JsonUri = z.infer<typeof erc8004AgentBase64JsonUriSchema>;

export type Erc8004AgentUri = z.infer<typeof erc8004AgentUriSchema>;

export type Erc8004AgentJobService = z.infer<typeof erc8004AgentJobServiceSchema>;
export type Erc8004AgentApiService = z.infer<typeof erc8004AgentApiServiceSchema>;
export type Erc8004AgentMcpService = z.infer<typeof erc8004AgentMcpServiceSchema>;

export type Erc8004AgentService = z.infer<typeof erc8004AgentServiceSchema>;

export type Erc8004AgentRegistration = z.infer<typeof erc8004AgentRegistrationSchema>;

export type Erc8004AgentRegistrationFile = z.infer<typeof erc8004AgentRegistrationFileSchema>;

export type Erc8004FeedbackFileProofOfPayment = z.infer<
  typeof erc8004FeedbackFileProofOfPaymentSchema
>;

export type Erc8004FeedbackFile = z.infer<typeof erc8004FeedbackFileSchema>;

export const resolveErc8004AgentRegistrationFile = async (
  uri: string
): Promise<Erc8004AgentRegistrationFile | null> => {
  const agentUriParsed = erc8004AgentUriSchema.safeParse(uri);
  if (!agentUriParsed.success) return null;

  const response = await fetch(agentUriParsed.data);
  if (!response.ok) return null;

  const json = await response.json().catch(() => ({}));

  const parsed = erc8004AgentRegistrationFileSchema.safeParse(json);
  if (!parsed.success) return null;

  return parsed.data;
};

export const resolveErc8004FeedbackFile = async (
  uri: string
): Promise<Erc8004FeedbackFile | null> => {
  const response = await fetch(uri).catch(() => null);
  if (!response?.ok) return null;

  const json = await response.json().catch(() => null);

  const parsed = erc8004FeedbackFileSchema.safeParse(json);
  if (!parsed.success) return null;

  return parsed.data;
};

export const normalizeErc8004FeedbackValue = (value: number | string, valueDecimals: number) =>
  Number(value) / 10 ** valueDecimals;

export const isErc8004AgentJobService = (service: unknown): service is Erc8004AgentJobService =>
  erc8004AgentJobServiceSchema.safeParse(service).success;

export const isErc8004AgentApiService = (service: unknown): service is Erc8004AgentApiService =>
  erc8004AgentApiServiceSchema.safeParse(service).success;

export const isErc8004AgentMcpService = (service: unknown): service is Erc8004AgentMcpService =>
  erc8004AgentMcpServiceSchema.safeParse(service).success;
