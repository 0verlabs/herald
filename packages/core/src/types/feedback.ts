import { z } from "zod";

import { agentIdSchema } from "./agent";

export const feedbackProofOfPaymentSchema = z.object({
  fromAddress: z.string(),
  toAddress: z.string(),
  chainId: z.string(),
  txHash: z.string(),
  amount: z.string().optional(),
  currency: z.string().optional(),
});

export const feedbackSchema = z.object({
  id: z.string(),
  agentId: agentIdSchema,
  clientAddress: z.string(),
  feedbackIndex: z.number().int().nonnegative(),
  value: z.number(),
  reasoning: z.string().nullable(),
  proofOfPayment: feedbackProofOfPaymentSchema.nullable(),
  revoked: z.boolean(),
});

export type FeedbackProofOfPayment = z.infer<typeof feedbackProofOfPaymentSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
