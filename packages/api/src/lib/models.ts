import { z } from "zod";

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

// Mirrors the model list exposed by @hrld/chat.
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

export const MODEL_PROVIDERS: Record<ModelId, ModelProvider> = {
  "claude-fable-5": "anthropic",
  "claude-opus-4-8": "anthropic",
  "claude-sonnet-5": "anthropic",
  "gpt-5.6-sol": "openai",
  "gpt-5.6-terra": "openai",
  "gpt-5.6-luna": "openai",
  "deepseek-v4-pro": "deepseek",
  "deepseek-v4-flash": "deepseek",
  "kimi-k3": "moonshotai",
  "minimax-m3": "minimax",
  "qwen3.7-max": "alibaba",
  "qwen3.7-plus": "alibaba",
  "qwen3.6-plus": "alibaba",
  "qwen3-vl-30b": "alibaba",
  "glm-5.2": "zhipuai",
  "glm-5.1": "zhipuai",
};

export const DEFAULT_MODEL: ModelId = "minimax-m3";
