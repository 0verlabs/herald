import { z } from "zod";

/**
 * Which Herald environment a deployment is: `testnet` serves the test
 * networks, `mainnet` the real ones. Herald runs as two separate deployments,
 * each with its own D1 database, KV namespace, gas wallets and URLs, and API
 * keys only work in one of them. Workers read it from the `HERALD_ENV` var in
 * their Wrangler config.
 */
export const HeraldEnvSchema = z.enum(["testnet", "mainnet"]);
export type HeraldEnv = z.infer<typeof HeraldEnvSchema>;

/**
 * A NEAR account id, following nearcore's validation rules: 2 to 64
 * characters, dot-separated parts of lowercase letters and digits, where `-`
 * and `_` may only sit between two alphanumerics.
 */
export const NearAccountIdSchema = z
  .string()
  .min(2, "Invalid NEAR account id: shorter than 2 characters")
  .max(64, "Invalid NEAR account id: longer than 64 characters")
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "Invalid NEAR account id");
export type NearAccountId = z.infer<typeof NearAccountIdSchema>;

/** A 20-byte EVM address. One is shared by every EVM chain Herald lists. */
export const EvmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address");
export type EvmAddress = z.infer<typeof EvmAddressSchema>;

/** A base58-encoded 32-byte Solana public key. */
export const SolanaAddressSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana address");
export type SolanaAddress = z.infer<typeof SolanaAddressSchema>;

/**
 * A Provider, identified by its Provider Account, with the Receiving
 * Addresses derived from it. `packages/db` keeps the `providers` table in
 * line with this schema.
 */
export const ProviderSchema = z.object({
  id: z.number().int().positive(),
  accountId: NearAccountIdSchema,
  evmAddress: EvmAddressSchema,
  solanaAddress: SolanaAddressSchema,
  createdAt: z.date(),
});
export type Provider = z.infer<typeof ProviderSchema>;
