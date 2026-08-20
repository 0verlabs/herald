import { Chain } from "@hrld/core";

export const CHAIN_BY_ID = {
  16661: "0g",
  16602: "0g-testnet",
} as const satisfies Record<number, Chain>;

export const getChainById = (id: keyof typeof CHAIN_BY_ID): Chain => CHAIN_BY_ID[id];
