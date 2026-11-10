import { HeraldEnvSchema } from "@herald/core";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// The client build strips server-function handlers, middleware `.server()`
// and `createServerOnlyFn` bodies, so keep every `env` read inside one of
// them; a plain exported helper would pull `cloudflare:workers` into the
// browser build.

/** The Herald environment this Worker serves, from the `HERALD_ENV` Wrangler var. Server only. */
export const readHeraldEnv = createServerOnlyFn(() => HeraldEnvSchema.parse(env.HERALD_ENV));

/** The Herald environment this Worker serves, for loaders and components. */
export const getHeraldEnv = createServerFn({ method: "GET" }).handler(() => readHeraldEnv());
