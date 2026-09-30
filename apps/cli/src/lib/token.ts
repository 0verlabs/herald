import { type EvmChain, viemChainByChain } from "@hrld/core";
import { type Address, createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { getCached, setCached } from "./cache.ts";

export type TokenMetadata = { decimals: number; symbol: string };

/**
 * Reads a token's decimals and symbol, cached forever per chain and address
 * since both are immutable for a deployed contract. Returns null when the
 * contract does not answer (not an ERC-20, wrong chain), so callers can fall
 * back to raw base units.
 */
export async function readTokenMetadata(
  chain: EvmChain,
  token: Address,
): Promise<TokenMetadata | null> {
  const key = `${chain}:${token.toLowerCase()}`;
  const cached = getCached<TokenMetadata>("token-metadata", key);
  if (cached) return cached;

  const client = createPublicClient({ chain: viemChainByChain[chain], transport: http() });
  const contract = { address: token, abi: erc20Abi } as const;
  const metadata = await Promise.all([
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "symbol" }),
  ])
    .then(([decimals, symbol]) => ({ decimals, symbol }))
    .catch(() => null);

  if (metadata) setCached("token-metadata", key, metadata);
  return metadata;
}

/** "0.05 W0G" when metadata is known, "50000000000000000 base units" when not. */
export function formatTokenAmount(amount: bigint, metadata: TokenMetadata | null): string {
  if (!metadata) return `${amount} base units`;
  return `${formatUnits(amount, metadata.decimals)} ${metadata.symbol}`;
}
