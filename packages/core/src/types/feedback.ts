import { z } from "zod";

import { agentIdSchema } from "./agent";

export const proofOfPaymentSchema = z.object({
  fromAddress: z.string(),
  toAddress: z.string(),
  chainId: z.string(),
  txHash: z.string(),
  amount: z.string().optional(),
  currency: z.string().optional(),
});

export const agentFeedbackSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  clientAddress: z.string(),
  feedbackIndex: z.number().int().nonnegative(),
  value: z.number(),
  reasoning: z.string().nullable(),
  proofOfPayment: proofOfPaymentSchema.nullable(),
  revoked: z.boolean(),
});

export type ProofOfPayment = z.infer<typeof proofOfPaymentSchema>;
export type AgentFeedback = z.infer<typeof agentFeedbackSchema>;
