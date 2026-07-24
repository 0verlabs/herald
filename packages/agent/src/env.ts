import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ModelProvider } from "./models";

const providerEnvSchema = z.object({
  apiUrl: z.url(),
  apiKey: z.string().min(1),
});

export type ProviderEnv = z.infer<typeof providerEnvSchema>;

// Each provider reads its own `<PROVIDER>_API_URL` / `<PROVIDER>_API_KEY`
// pair, e.g. `ANTHROPIC_API_URL` + `ANTHROPIC_API_KEY`. URLs default in
// wrangler.jsonc `vars`; keys are secrets (`.dev.vars` locally).
export function providerEnv(env: Env, provider: ModelProvider): ProviderEnv {
  // Keys are looked up dynamically (`<PROVIDER>_API_KEY` secrets aren't part
  // of the generated Env type), hence the escape hatch.
  const bag = env as unknown as Record<string, unknown>;
  const prefix = provider.toUpperCase();

  const parsed = providerEnvSchema.safeParse({
    apiUrl: bag[`${prefix}_API_URL`],
    apiKey: bag[`${prefix}_API_KEY`],
  });

  if (!parsed.success) {
    throw new HTTPException(500, {
      message: `Provider "${provider}" is not configured: set ${prefix}_API_URL and ${prefix}_API_KEY`,
    });
  }

  return parsed.data;
}
