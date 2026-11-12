import { z } from "zod";
import { USDC_DECIMALS } from "./price.ts";
import type { HeraldEnv } from "./schemas.ts";

/**
 * A CAIP-2 network id (`namespace:reference`), as x402 v2 uses in `network`:
 * `eip155:8453` for Base, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` for
 * Solana mainnet.
 */
export const Caip2Schema = z
  .string()
  .regex(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/, 'must be a CAIP-2 network id like "eip155:8453"')
  .transform((id) => id as Caip2);
export type Caip2 = `${string}:${string}`;

/**
 * A network Herald lists in one Herald environment, identified by its CAIP-2
 * id, with its USDC deployment.
 *
 * Every EVM network shares the Provider's EVM Receiving Address. `eip712` is
 * the USDC contract's EIP-712 domain, which EIP-3009 signatures (Buyer
 * payments and Sweeps) commit to. `txExplorer` is a block explorer's page
 * for a transaction, with `{txHash}` where the hash goes (see
 * `explorerTxUrl`).
 *
 * `native` is the chain's own token, which pays its gas: Herald's gas
 * wallet (on NEAR, its relayer) holds it.
 *
 * On NEAR, `usdc.address` is the NEP-141 contract's account id, and
 * Receiving Addresses are implicit accounts (64 lowercase hex characters).
 */
export type Network =
  | {
      kind: "evm";
      caip2: Caip2;
      label: string;
      usdc: { address: string; decimals: number; eip712: { name: string; version: string } };
      native: NativeToken;
      txExplorer: string;
    }
  | {
      kind: "solana";
      caip2: Caip2;
      label: string;
      usdc: { address: string; decimals: number };
      native: NativeToken;
      txExplorer: string;
    }
  | {
      kind: "near";
      caip2: Caip2;
      label: string;
      usdc: { address: string; decimals: number };
      native: NativeToken;
      txExplorer: string;
    };

/** The kind of chain a network is, which decides how Herald pays and Sweeps on it. */
export type NetworkKind = Network["kind"];

/**
 * The `default` of a `switch` over a chain kind (or anything else) that
 * handles every case. The type checker rejects the call when a case is
 * missing, so adding a kind fails to compile at every branch that doesn't
 * handle it. Throws if reached at run time with a value the types ruled out.
 */
export function unhandledKind(kind: never): never {
  throw new Error(`Unhandled kind: ${JSON.stringify(kind)}`);
}

/** A chain's native token: its symbol and decimals (18 for ETH, 9 for SOL). */
export type NativeToken = { symbol: string; decimals: number };

const ETH: NativeToken = { symbol: "ETH", decimals: 18 };
const SOL: NativeToken = { symbol: "SOL", decimals: 9 };
const NEAR: NativeToken = { symbol: "NEAR", decimals: 24 };

// Domains were read from each contract's `name()` / `version()` on
// 2026-11-10; the opt-in live test in live.test.ts re-checks them. Testnet
// USDC can differ from mainnet: Base Sepolia's is named "USDC".
const USD_COIN_V2 = { name: "USD Coin", version: "2" };

const mainnet: readonly Network[] = [
  {
    kind: "evm",
    caip2: "eip155:8453",
    label: "Base",
    usdc: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
    native: ETH,
    txExplorer: "https://basescan.org/tx/{txHash}",
  },
  {
    kind: "solana",
    caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    label: "Solana",
    usdc: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: USDC_DECIMALS },
    native: SOL,
    txExplorer: "https://explorer.solana.com/tx/{txHash}",
  },
  {
    kind: "evm",
    caip2: "eip155:42161",
    label: "Arbitrum",
    usdc: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
    native: ETH,
    txExplorer: "https://arbiscan.io/tx/{txHash}",
  },
  {
    kind: "evm",
    caip2: "eip155:137",
    label: "Polygon",
    usdc: {
      address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
    native: { symbol: "POL", decimals: 18 },
    txExplorer: "https://polygonscan.com/tx/{txHash}",
  },
  {
    kind: "evm",
    caip2: "eip155:43114",
    label: "Avalanche",
    usdc: {
      address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
    native: { symbol: "AVAX", decimals: 18 },
    txExplorer: "https://snowtrace.io/tx/{txHash}",
  },
];

// Polygon and Avalanche have no Herald testnet. NEAR is listed on testnet
// only until its mainnet relayer is funded (spec #30).
const testnet: readonly Network[] = [
  {
    kind: "near",
    caip2: "near:testnet",
    label: "NEAR Testnet",
    // Circle's testnet USDC (NEP-141), not `usdc.testnet`. Its `ft_metadata`
    // is re-checked by the opt-in live test in live.test.ts.
    usdc: {
      address: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
      decimals: USDC_DECIMALS,
    },
    native: NEAR,
    txExplorer: "https://testnet.nearblocks.io/txns/{txHash}",
  },
  {
    kind: "evm",
    caip2: "eip155:84532",
    label: "Base Sepolia",
    usdc: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      decimals: USDC_DECIMALS,
      eip712: { name: "USDC", version: "2" },
    },
    native: ETH,
    txExplorer: "https://sepolia.basescan.org/tx/{txHash}",
  },
  {
    kind: "solana",
    caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    label: "Solana Devnet",
    usdc: { address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: USDC_DECIMALS },
    native: SOL,
    txExplorer: "https://explorer.solana.com/tx/{txHash}?cluster=devnet",
  },
  {
    kind: "evm",
    caip2: "eip155:421614",
    label: "Arbitrum Sepolia",
    usdc: {
      address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      decimals: USDC_DECIMALS,
      eip712: USD_COIN_V2,
    },
    native: ETH,
    txExplorer: "https://sepolia.arbiscan.io/tx/{txHash}",
  },
];

/**
 * The networks each Herald environment lists, in Payment Option order: on
 * testnet NEAR Testnet, Base Sepolia, Solana Devnet, Arbitrum Sepolia; on
 * mainnet Base, Solana, Arbitrum, Polygon, Avalanche.
 */
export const networkRegistry: Readonly<Record<HeraldEnv, readonly Network[]>> = {
  mainnet,
  testnet,
};

/** The network Herald lists under a CAIP-2 id, in either Herald environment. */
export function findNetwork(caip2: string): Network | undefined {
  return [...networkRegistry.mainnet, ...networkRegistry.testnet].find((n) => n.caip2 === caip2);
}

/** A block explorer's page for a transaction on `network`. */
export function explorerTxUrl(network: Network, txHash: string): string {
  return network.txExplorer.replace("{txHash}", encodeURIComponent(txHash));
}
