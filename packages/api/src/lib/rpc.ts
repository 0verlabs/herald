import type { ChainSlug } from "../types/chain";
import { env } from "../env";

// The env-backed edge of the chain registry, kept out of `chains.ts` so the registry itself
// stays importable without a parsed environment. Keys follow the indexer's `RPC_URL_<chainId>`
// convention. Mainnet is optional and falls back to the viem chain's own public RPC.
export const rpcUrls: Record<ChainSlug, string | undefined> = {
  "0g": env.RPC_URL_16661,
  "0g-testnet": env.RPC_URL_16602,
};
