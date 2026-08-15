import z from "zod";

export const agentUriSchema = z.string().startsWith("data:application/json;base64,");
export type AgentUri = z.infer<typeof agentUriSchema>;

// Services in the registration file are intentionally not parsed for now —
// the Service model is being redesigned.
export const agentRegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string(),
  description: z.string(),
  image: z.url(),
  tags: z.array(z.string()).optional(),
  x402Support: z.boolean(),
  supportedTrust: z.array(z.string()).optional(),
});
export type AgentRegistrationFile = z.infer<typeof agentRegistrationFileSchema>;
