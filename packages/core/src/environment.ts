import type { Environment } from "./schemas.ts";

/**
 * Maps the Wrangler environment a Worker was built for (`CLOUDFLARE_ENV`) to
 * the Herald environment. `production` is mainnet; `testnet`, or no
 * environment at all (local dev, tests), is testnet. Anything else throws, so
 * a typo can never silently point a deployment at the wrong chains.
 */
export function environmentFromCloudflareEnv(cloudflareEnv: string | undefined): Environment {
  switch (cloudflareEnv) {
    case "production":
      return "mainnet";
    case "testnet":
    case "":
    case undefined:
      return "testnet";
    default:
      throw new Error(
        `Unknown CLOUDFLARE_ENV "${cloudflareEnv}": expected "production", "testnet" or unset`,
      );
  }
}
