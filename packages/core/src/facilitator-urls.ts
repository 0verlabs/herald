import type { Network } from "./schemas.ts";

/**
 * Herald's facilitator per network, for the stock `HTTPFacilitatorClient`'s
 * `url`. These are the workers.dev URLs of the Workers in
 * apps/facilitator/wrangler.jsonc.
 */
export const facilitatorUrls = {
  mainnet: "https://herald-facilitator-mainnet.luckzivanius.workers.dev",
  testnet: "https://herald-facilitator-testnet.luckzivanius.workers.dev",
} as const satisfies Record<Network, string>;
