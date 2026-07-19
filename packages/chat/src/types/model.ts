import { z } from "zod";

export const modelIdSchema = z.enum([
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
]);

export type ModelId = z.infer<typeof modelIdSchema>;
