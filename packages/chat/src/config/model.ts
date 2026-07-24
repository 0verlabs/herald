import type { Model, ModelId } from "../types/model";
import { modelIdSchema } from "../types/model";

export const MODEL_IDS = modelIdSchema.options;

export const MODELS: Record<ModelId, Model> = {
  "claude-fable-5": {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    provider: "anthropic",
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
  },
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openai",
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    provider: "openai",
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    provider: "openai",
  },
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
  },
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
  },
  "kimi-k3": {
    id: "kimi-k3",
    label: "Kimi K3",
    provider: "moonshotai",
  },
  "minimax-m3": {
    id: "minimax-m3",
    label: "MiniMax M3",
    provider: "minimax",
  },
  "qwen3.7-max": {
    id: "qwen3.7-max",
    label: "Qwen3.7 Max",
    provider: "alibaba",
  },
  "qwen3.7-plus": {
    id: "qwen3.7-plus",
    label: "Qwen3.7 Plus",
    provider: "alibaba",
  },
  "qwen3.6-plus": {
    id: "qwen3.6-plus",
    label: "Qwen3.6 Plus",
    provider: "alibaba",
  },
  "qwen3-vl-30b": {
    id: "qwen3-vl-30b",
    label: "Qwen3-VL 30B",
    provider: "alibaba",
  },
  "glm-5.2": {
    id: "glm-5.2",
    label: "GLM-5.2",
    provider: "zhipuai",
  },
  "glm-5.1": {
    id: "glm-5.1",
    label: "GLM-5.1",
    provider: "zhipuai",
  },
};

export const DEFAULT_MODEL: ModelId = "glm-5.1";
