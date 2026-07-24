import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { ProviderEnv } from "./env";
import type { ModelId } from "./models";
import { MODEL_PROVIDERS } from "./models";

const ANTHROPIC_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
] as const satisfies readonly ModelId[];

type AnthropicModelId = (typeof ANTHROPIC_MODELS)[number];

function isAnthropicModel(model: ModelId): model is AnthropicModelId {
  return (ANTHROPIC_MODELS as readonly ModelId[]).includes(model);
}

// Anthropic gets the native provider; every other provider speaks the
// OpenAI-compatible chat completions API through its own base URL.
export function createModel(model: ModelId, { apiUrl, apiKey }: ProviderEnv): LanguageModel {
  if (isAnthropicModel(model)) {
    return createAnthropic({ apiKey, baseURL: apiUrl })(model);
  }

  return createOpenAICompatible({
    name: MODEL_PROVIDERS[model],
    baseURL: apiUrl,
    apiKey,
  })(model);
}
