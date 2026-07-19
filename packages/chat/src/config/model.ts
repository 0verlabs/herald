import type { ModelId } from "../types/model";
import { modelIdSchema } from "../types/model";

export const MODEL_IDS = modelIdSchema.options;

export const MODEL_LABELS: Record<ModelId, string> = {
  "claude-fable-5": "Fable 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5": "Haiku 4.5",
};

export const DEFAULT_MODEL: ModelId = "claude-fable-5";
