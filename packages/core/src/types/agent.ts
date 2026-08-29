import { z } from "zod";

import { chainSchema } from "./chain";

export const agentOnchainIdSchema = z.number().int().nonnegative();

export const agentIdCodec = z.codec(
  z.templateLiteral([chainSchema, "_", agentOnchainIdSchema]),
  z.object({
    chain: chainSchema,
    onchainId: agentOnchainIdSchema,
  }),
  {
    encode: ({ chain, onchainId }) => `${chain}_${onchainId}` as const,
    decode: (str) => {
      const [chainStr, onchainIdStr] = str.split("_");

      const chain = chainSchema.parse(chainStr);
      const onchainId = agentOnchainIdSchema.parse(onchainIdStr);

      return {
        chain,
        onchainId,
      };
    },
  }
);

export const agentServiceCountSchema = z.object({
  job: z.number().int().nonnegative(),
  api: z.number().int().nonnegative(),
  mcp: z.number().int().nonnegative(),
});

export const agentIdSchema = agentIdCodec.in;

export const agentSchema = z.object({
  id: agentIdSchema,
  chain: chainSchema,
  onchainId: agentOnchainIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  category: z.string().nullable(),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
  serviceCounts: agentServiceCountSchema.default({ job: 0, api: 0, mcp: 0 }),
  wallet: z.string().nullable(),
  owner: z.string(),
  active: z.boolean(),
});

export const agentSummarySchema = z.object({
  id: agentIdSchema,
  chain: chainSchema,
  onchainId: agentOnchainIdSchema,
  name: z.string(),
  description: z.string(),
  image: z.string(),
  score: z.number().min(0).max(100),
  feedbackCounts: z.number().nonnegative(),
  owner: z.string(),
});

export const agentJobServiceSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  name: z.literal("JOB"),
  title: z.string(),
  description: z.string(),
});

export const agentApiServiceSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  name: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  endpoint: z.string(),
  version: z.string(),
  description: z.string(),
});

export const agentMcpServiceSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  name: z.literal("MCP"),
  endpoint: z.string(),
  version: z.string(),
  tools: z.string().array().default([]),
  resources: z.string().array().default([]),
  prompts: z.string().array().default([]),
});

export const agentServiceSchema = z.union([
  agentJobServiceSchema,
  agentApiServiceSchema,
  agentMcpServiceSchema,
]);

export type AgentId = z.infer<typeof agentIdSchema>;
export type AgentServiceCount = z.infer<typeof agentServiceCountSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentSummary = z.infer<typeof agentSummarySchema>;
export type AgentJobService = z.infer<typeof agentJobServiceSchema>;
export type AgentApiService = z.infer<typeof agentApiServiceSchema>;
export type AgentMcpService = z.infer<typeof agentMcpServiceSchema>;
export type AgentService = z.infer<typeof agentServiceSchema>;
