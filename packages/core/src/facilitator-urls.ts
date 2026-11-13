import type { HeraldEnv } from "./schemas.ts";

/**
 * Herald's facilitator per Herald environment, for the stock
 * `HTTPFacilitatorClient`'s `url`. These are the custom domains of the
 * Workers in apps/facilitator/wrangler.jsonc. No trailing slash: the client
 * appends `/verify`, `/settle` and `/supported`.
 */
export const facilitatorUrls = {
  mainnet: "https://facilitator.herald.0verlabs.com",
  testnet: "https://facilitator.herald-testnet.0verlabs.com",
} as const satisfies Record<HeraldEnv, string>;
