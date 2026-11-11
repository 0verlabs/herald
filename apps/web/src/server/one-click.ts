import { httpOneClickClient, type OneClickClient } from "@herald/core/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

/**
 * 1Click, for cross-chain and Intents Sweeps. Server only.
 *
 * `ONE_CLICK_JWT` is an optional Worker secret: a 1Click partner key, which
 * lowers 1Click's fee on some routes. Without it 1Click still quotes. It is
 * left out of `secrets.required` on purpose, since `wrangler deploy` refuses
 * to deploy without a required secret, so `wrangler types` doesn't type it
 * and it is read here as an unknown value.
 */
export const oneClickClient = createServerOnlyFn((): OneClickClient => {
  const jwt: unknown = Reflect.get(env, "ONE_CLICK_JWT");
  return httpOneClickClient({ apiKey: typeof jwt === "string" && jwt !== "" ? jwt : undefined });
});
