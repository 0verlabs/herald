import { z } from "zod";

// Ids double as models.dev logo slugs — see `providerLogoUrl`.
export const modelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "deepseek",
  "moonshotai",
  "minimax",
  "alibaba",
  "zhipuai",
]);

export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelIdSchema = z.enum([
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "kimi-k3",
  "minimax-m3",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3-vl-30b",
  "glm-5.2",
  "glm-5.1",
]);

export type ModelId = z.infer<typeof modelIdSchema>;

export const modelSchema = z.object({
  id: modelIdSchema,
  label: z.string(),
  provider: modelProviderSchema,
});

export type Model = z.infer<typeof modelSchema>;
