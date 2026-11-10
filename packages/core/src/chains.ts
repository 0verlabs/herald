import { z } from "zod";
import { USDC_DECIMALS } from "./price.ts";
import type { Network } from "./schemas.ts";

const chainNames = ["base", "solana", "arbitrum", "polygon", "avalanche"] as const;

/** The chains Herald lists, in the order Payment Options are offered. */
export const ChainNameSchema = z.enum(chainNames, {
  error: (issue) =>
    `Unknown chain ${JSON.stringify(issue.input)}, expected one of ${chainNames.map((n) => `"${n}"`).join(", ")}`,
});
export type ChainName = z.infer<typeof ChainNameSchema>;

/** A CAIP-2 chain id, as x402 v2 uses in `network`. */
export type CaipNetwork = `${string}:${string}`;

/**
 * One chain in one Herald network, with its USDC deployment.
 *
 * Every EVM chain shares the Provider's EVM Receiving Address. `eip712` is
 * the USDC contract's EIP-712 domain, which EIP-3009 signatures (Buyer
 * payments and Sweeps) commit to.
 */
export type Chain =
  | {
      kind: "evm";
      name: ChainName;
      label: string;
      network: CaipNetwork;
      chainId: number;
      usdc: { address: string; decimals: number; eip712: { name: string; version: string } };
    }
  | {
      kind: "solana";
      name: ChainName;
      label: string;
      network: CaipNetwork;
      usdc: { address: string; decimals: number };
    };

// Domains were read from each contract's `name()` / `version()` on
// 2026-11-10; the opt-in live test in live.test.ts re-checks them. Testnet
// USDC can differ from mainnet: Base Sepolia's is named "USDC".
const USD_COIN_V2 = { name: "USD Coin", version: "2" };

const mainnet: readonly Chain[] = [
  {
    kind: "evm",
    name: "base",
    label: "Base",
    network: "eip155:8453",
    chainId: 8453,
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
  },
  {
    kind: "solana",
    name: "solana",
    label: "Solana",
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    usdc: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: USDC_DECIMALS },
  },
  {
    kind: "evm",
    name: "arbitrum",
    label: "Arbitrum",
    network: "eip155:42161",
    chainId: 42161,
    usdc: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
  },
  {
    kind: "evm",
    name: "polygon",
    label: "Polygon",
    network: "eip155:137",
    chainId: 137,
    usdc: {
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
  },
  {
    kind: "evm",
    name: "avalanche",
    label: "Avalanche",
    network: "eip155:43114",
    chainId: 43114,
    usdc: {
      address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
  },
];

// Polygon and Avalanche have no Herald testnet.
const testnet: readonly Chain[] = [
  {
    kind: "evm",
    name: "base",
    label: "Base Sepolia",
    network: "eip155:84532",
    chainId: 84532,
    usdc: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      decimals: USDC_DECIMALS,
      eip712: { name: "USDC", version: "2" },
    },
  },
  {
    kind: "solana",
    name: "solana",
    label: "Solana Devnet",
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    usdc: { address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: USDC_DECIMALS },
  },
  {
    kind: "evm",
    name: "arbitrum",
    label: "Arbitrum Sepolia",
    network: "eip155:421614",
    chainId: 421614,
    usdc: {
      address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
  },
];

/** The chains a Herald network lists, in Payment Option order. */
export const chainRegistry: Readonly<Record<Network, readonly Chain[]>> = { mainnet, testnet };
