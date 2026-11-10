import { z } from "zod";
import { Caip2Schema } from "./networks.ts";

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
 * Where creating a Provider's USDC token account on Solana stands. A Solana
 * payment can only land in a Receiving Address that has one, so Herald
 * creates it, paying the rent, through its Solana chain queue:
 *
 * - `not_queued`: not handed to the chain queue yet, or handing it over failed.
 * - `queued`: the chain queue has it and is creating it.
 * - `created`: it exists on-chain.
 * - `failed`: the chain queue gave up after retrying.
 */
export const SolanaTokenAccountStatusSchema = z.enum(["not_queued", "queued", "created", "failed"]);
export type SolanaTokenAccountStatus = z.infer<typeof SolanaTokenAccountStatusSchema>;

/**
 * A Provider, identified by its Provider Account, with the Receiving
 * Addresses derived from it and the state of its Solana USDC token account.
 * `packages/db` keeps the `providers` table in line with this schema.
 */
export const ProviderSchema = z.object({
  id: z.number().int().positive(),
  accountId: NearAccountIdSchema,
  evmAddress: EvmAddressSchema,
  solanaAddress: SolanaAddressSchema,
  solanaTokenAccountStatus: SolanaTokenAccountStatusSchema,
  createdAt: z.date(),
});
export type Provider = z.infer<typeof ProviderSchema>;

/** How a Herald API key starts in each Herald environment. */
export const apiKeyPrefixes = {
  testnet: "hk_test_",
  mainnet: "hk_live_",
} as const satisfies Record<HeraldEnv, string>;

/**
 * A Provider's Herald API key, without the key itself: Herald stores only
 * its SHA-256 hash and `prefix`, the first characters, for display. A key
 * works in one Herald environment only (`hk_test_…` on testnet, `hk_live_…`
 * on mainnet). `packages/db` keeps the `api_keys` table in line with this
 * schema.
 */
export const ApiKeySchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  env: HeraldEnvSchema,
  prefix: z
    .string()
    .refine((prefix) => Object.values(apiKeyPrefixes).some((p) => prefix.startsWith(p))),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

/**
 * A Buyer payment Herald's facilitator settled into a Provider's Receiving
 * Address. `amount` is in base units of `asset`. A transaction hash is unique
 * per network. `packages/db` keeps the `payments` table in line with this
 * schema.
 */
export const PaymentSchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  apiKeyId: z.number().int().positive(),
  network: Caip2Schema,
  asset: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  buyerAddress: z.string().min(1),
  txHash: z.string().min(1),
  resourceUrl: z.string().nullable(),
  settledAt: z.date(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/**
 * The smallest amount of an asset a Provider may Sweep from a network, in
 * base units, with a note on where the figure comes from. Herald blocks
 * Sweeps below it so a Provider doesn't lose funds to fees or 1Click
 * minimums. `packages/db` keeps the `sweep_minimums` table in line with
 * this schema.
 */
export const SweepMinimumSchema = z.object({
  network: Caip2Schema,
  asset: z.string().min(1),
  minimum: z.string().regex(/^\d+$/),
  note: z.string(),
  updatedAt: z.date(),
});
export type SweepMinimum = z.infer<typeof SweepMinimumSchema>;

/**
 * Where a Sweep sends funds. `same_chain`: any address on the source
 * network.
 */
export const SweepDestinationKindSchema = z.enum(["same_chain"]);
export type SweepDestinationKind = z.infer<typeof SweepDestinationKindSchema>;

/**
 * Where a Sweep stands:
 *
 * - `planned`: Herald built the payload; the Provider hasn't signed it yet.
 * - `awaiting_signature`: the Provider's wallet sent the NEAR transaction
 *   asking the MPC signer to sign it; Herald waits for the signature.
 * - `submitted`: Herald submitted the signed transfer through the chain
 *   queue.
 * - `confirmed`: the transfer landed on-chain.
 * - `failed`: it didn't, and won't; `error` says why.
 */
export const SweepStatusSchema = z.enum([
  "planned",
  "awaiting_signature",
  "submitted",
  "confirmed",
  "failed",
]);
export type SweepStatus = z.infer<typeof SweepStatusSchema>;

const Hex32Schema = z.string().regex(/^0x[0-9a-f]{64}$/, "Expected 32 bytes of lowercase hex");

/**
 * A Sweep: moving `amount` (base units of `asset`) out of a Provider's
 * Receiving Address on `sourceNetwork`. On EVM it is an EIP-3009
 * `transferWithAuthorization` with `authorizationNonce`, valid strictly
 * between `validAfter` and `validBefore` (Unix seconds), whose EIP-712 hash
 * is `payloadHash`. `packages/db` keeps the `sweeps` table in line with this
 * schema.
 */
export const SweepSchema = z.object({
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  sourceNetwork: Caip2Schema,
  asset: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  destinationKind: SweepDestinationKindSchema,
  destinationNetwork: Caip2Schema,
  destinationAddress: z.string().min(1),
  authorizationNonce: Hex32Schema,
  validAfter: z.number().int().nonnegative(),
  validBefore: z.number().int().positive(),
  payloadHash: Hex32Schema,
  nearTxHash: z.string().nullable(),
  sourceTxHash: z.string().nullable(),
  status: SweepStatusSchema,
  error: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  submittedAt: z.date().nullable(),
});
export type Sweep = z.infer<typeof SweepSchema>;
