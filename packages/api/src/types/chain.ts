import type { Chain } from "viem";
import { networks } from "@hrld/db";
import { z } from "zod";

export const chainSlugs = ["0g", "0g-testnet"] as const;

export type ChainSlug = (typeof chainSlugs)[number];

// Chains a tool may act on. Mainnet is in the registry for its USDC deployment but is
// deliberately not selectable: a mainnet transfer moves real funds, and until the approval
// prompt and tool outputs name the chain, a user cannot tell one from a testnet transfer.
export const callableChainSlugs = ["0g-testnet"] as const satisfies readonly ChainSlug[];

export const callableChainSlugSchema = z.enum(callableChainSlugs);

// CAIP-2 `<namespace>:<reference>`, e.g. `eip155:16602`, or a `solana:…` base58 reference.
// Deliberately not narrowed to `eip155`: Herald is EVM-only today, but a Chain identifier is not
// an EVM concept, and this schema is what the domain layer validates against.
const caip2Schema = z.templateLiteral([
  z.string().regex(/^[-a-z0-9]{3,8}$/),
  ":",
  z.string().regex(/^[-_a-zA-Z0-9]{1,32}$/),
]);

const nativeTokenSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
});

// `address` is an opaque chain-native string — hex on EVM, base58 on Solana — so it is not
// validated as `0x…` here. Callers narrow it to their chain's address type at the transport
// boundary, e.g. viem's `getAddress`.
const tokenSchema = nativeTokenSchema.extend({
  address: z.string().min(1),
});

export const chainSchema = z.object({
  caip2: caip2Schema,
  // Network is the VM family (CONTEXT.md), which is what decides how the fields below are read.
  network: z.enum(networks),
  tokens: z.object({
    native: nativeTokenSchema,
    // Absent where the token has no deployment on the chain.
    usdc: tokenSchema.optional(),
  }),
  // Explorers differ per chain in host, path and query, so the registry supplies the builder
  // rather than a base URL every caller concatenates onto in its own way.
  txUrl: z.custom<(txHash: string) => string>((value) => typeof value === "function"),
});

type ChainConfig = z.infer<typeof chainSchema>;

// Every chain Herald serves today is EVM, so each registry entry also carries a viem chain
// definition for transport. When a non-EVM chain lands this becomes a union and the general
// `chainSchema` above does not have to move.
export type EvmChainConfig = ChainConfig & { network: "evm"; chain: Chain };
