import { agentServiceSchema } from "@hrld/core";
import z from "zod";

export const agentZgStorageUriSchema = z.string().startsWith("0g://");
export const agentDataUriSchema = z.string().startsWith("data:application/json;base64,");

export const agentUriSchema = z.union([agentZgStorageUriSchema, agentDataUriSchema]);

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
