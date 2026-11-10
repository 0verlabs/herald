import { HeraldEnvSchema, type Caip2, type HeraldEnv } from "@herald/core";
import { base58 } from "@scure/base";
import { address, type Address } from "@solana/kit";
import { createPublicClient, http, type Chain, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, polygon } from "viem/chains";

/** viem's chain definition for each EVM network Herald lists. */
const evmChains: Partial<Record<Caip2, Chain>> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
  "eip155:42161": arbitrum,
  "eip155:421614": arbitrumSepolia,
  "eip155:137": polygon,
  "eip155:43114": avalanche,
};

export function heraldEnvOf(env: CloudflareBindings): HeraldEnv {
  return HeraldEnvSchema.parse(env.HERALD_ENV);
}

export function evmChain(network: Caip2): Chain {
  const chain = evmChains[network];
  if (!chain) throw new Error(`No EVM chain definition for ${network}`);
  return chain;
}

/** The JSON-RPC endpoint for a network, from the `RPC_URLS` var. */
export function rpcUrl(env: CloudflareBindings, network: Caip2): string {
  const urls: Record<string, string | undefined> = env.RPC_URLS;
  const url = urls[network];
  if (!url) throw new Error(`RPC_URLS has no endpoint for ${network}`);
  return url;
}

export function evmPublicClient(env: CloudflareBindings, network: Caip2): PublicClient {
  return createPublicClient({
    chain: evmChain(network),
    transport: http(rpcUrl(env, network)),
    pollingInterval: 1_000,
  });
}

/** Herald's EVM gas wallet, shared by every EVM network. */
export function evmGasAccount(env: CloudflareBindings): PrivateKeyAccount {
  const key = env.EVM_GAS_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("The EVM_GAS_KEY secret must be a 0x-prefixed 32-byte hex private key");
  }
  return privateKeyToAccount(key as Hex);
}

/**
 * The address of Herald's Solana fee payer. `SOLANA_GAS_KEY` is a base58
 * 64-byte secret key (seed then public key, as `solana-keygen` writes it),
 * so the address is its second half.
 */
export function solanaFeePayerAddress(env: CloudflareBindings): Address {
  const key = env.SOLANA_GAS_KEY ? base58.decode(env.SOLANA_GAS_KEY) : undefined;
  if (key?.length !== 64) {
    throw new Error("The SOLANA_GAS_KEY secret must be a base58 64-byte secret key");
  }
  return address(base58.encode(key.subarray(32)));
}
