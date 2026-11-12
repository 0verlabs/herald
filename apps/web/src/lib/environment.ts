import type { HeraldEnv } from "@herald/core";

/** How the dashboard names each Herald environment. */
export const environmentLabels: Record<HeraldEnv, string> = {
  testnet: "Test mode",
  mainnet: "Live",
};

/** One line on what the environment means for the money in it. */
export const environmentNotes: Record<HeraldEnv, string> = {
  testnet: "Test money on test networks. Nothing here is worth real dollars.",
  mainnet: "Real stablecoins on live networks.",
};
