import { z } from "zod";

import type { Env } from "../env";
import type { ModelProvider } from "./models";

const providerEnvSchema = z.object({
  apiUrl: z.url(),
  apiKey: z.string().min(1),
});

export type ProviderEnv = z.infer<typeof providerEnvSchema>;

export function providerEnv(env: Env, provider: ModelProvider): ProviderEnv | null {
  const bag = env as unknown as Record<string, unknown>;
  const prefix = provider.toUpperCase() as Uppercase<ModelProvider>;

  const parsed = providerEnvSchema.safeParse({
    apiUrl: bag[`${prefix}_API_URL`],
    apiKey: bag[`${prefix}_API_KEY`],
  });

  if (!parsed.success) return null;

  return parsed.data;
}
