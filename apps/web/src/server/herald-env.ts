import { HeraldEnvSchema } from "@herald/core";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// Only server-function handlers are stripped from the client bundle, so keep
// every `env` read inside one; a plain exported helper would pull
// `cloudflare:workers` into the browser build.

/** The Herald environment this Worker serves, from the `HERALD_ENV` Wrangler var. */
export const getHeraldEnv = createServerFn({ method: "GET" }).handler(() =>
  HeraldEnvSchema.parse(env.HERALD_ENV),
);
