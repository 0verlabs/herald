import { NetworkSchema } from "@herald/core";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// Only server-function handlers are stripped from the client bundle, so keep
// every `env` read inside one; a plain exported helper would pull
// `cloudflare:workers` into the browser build.

/** The Herald network this Worker serves, from the `NETWORK` Wrangler var. */
export const getNetwork = createServerFn({ method: "GET" }).handler(() =>
  NetworkSchema.parse(env.NETWORK),
);
