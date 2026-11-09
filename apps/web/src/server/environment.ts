import { EnvironmentSchema } from "@herald/core";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

/** The Herald environment this Worker was deployed as. */
export const getEnvironment = createServerFn({ method: "GET" }).handler(() =>
  EnvironmentSchema.parse(env.HERALD_ENV),
);
