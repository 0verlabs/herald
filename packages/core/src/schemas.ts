import { z } from "zod";
import { Caip2Schema } from "./networks.ts";
import { USDC_DECIMALS } from "./price.ts";

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

/**
 * A NEAR implicit account id: the lowercase hex of an ed25519 public key, 64
 * characters. NEAR Receiving Addresses are implicit accounts (ADR-0009).
 */
export const NearImplicitAccountSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Invalid NEAR implicit account id");
export type NearImplicitAccount = z.infer<typeof NearImplicitAccountSchema>;

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
 * Where a Provider's NEAR Receiving Address stands: Herald creates the
 * implicit account and registers it on USDC (NEP-145) before NEAR payments
 * to it can verify.
 *
 * - `not_queued`: not handed to the NEAR chain queue yet, handing it over
 *   failed, or the queue gave up after retrying.
 * - `queued`: the NEAR chain queue has it and is setting it up.
 * - `created`: the account exists and is registered on USDC.
 */
export const NearSetupStatusSchema = z.enum(["not_queued", "queued", "created"]);
export type NearSetupStatus = z.infer<typeof NearSetupStatusSchema>;

/**
 * A Provider, identified by its Provider Account, with the Receiving
 * Addresses derived from it, the state of its Solana USDC token account and
 * the setup of its NEAR Receiving Address.
 * `packages/db` keeps the `providers` table in line with this schema, except
 * that `near_address` is null on rows from before NEAR until core fills it
 * in (`providerFromRow`).
 */
export const ProviderSchema = z.object({
  id: z.number().int().positive(),
  accountId: NearAccountIdSchema,
  evmAddress: EvmAddressSchema,
  solanaAddress: SolanaAddressSchema,
  nearAddress: NearImplicitAccountSchema,
  solanaTokenAccountStatus: SolanaTokenAccountStatusSchema,
  nearSetupStatus: NearSetupStatusSchema,
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
 * An admin's edit of one `sweep_minimums` row, named by its network and
 * asset: the new `minimum` as a USDC amount (`"0.15"`, every asset Herald
 * lists being USDC) and the new `note`, trimmed. The dashboard checks a form
 * against it before sending, and the server again.
 */
export const SweepMinimumEditSchema = z.object({
  network: Caip2Schema,
  asset: z.string().min(1),
  minimum: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d+)?$/, 'Enter a USDC amount like "0.15"')
    .refine(
      (amount) => (amount.split(".")[1]?.length ?? 0) <= USDC_DECIMALS,
      `USDC has at most ${USDC_DECIMALS} decimal places`,
    )
    .refine((amount) => /[1-9]/.test(amount), "The minimum must be more than 0"),
  note: z
    .string()
    .trim()
    .min(1, "Say where the figure comes from")
    .max(500, "Keep the note to 500 characters"),
});
export type SweepMinimumEdit = z.input<typeof SweepMinimumEditSchema>;

/**
 * Where a Sweep sends funds:
 *
 * - `same_chain`: any address on the source network.
 * - `cross_chain`: USDC at an address on another network, through 1Click.
 * - `intents`: the Provider Account's NEAR Intents account, through 1Click.
 *
 * The 1Click kinds transfer to the quote's deposit address, and 1Click
 * delivers from there. 1Click runs on mainnet only.
 */
export const SweepDestinationKindSchema = z.enum(["same_chain", "cross_chain", "intents"]);
export type SweepDestinationKind = z.infer<typeof SweepDestinationKindSchema>;

/** The `destinationNetwork` of an `intents` Sweep: NEAR mainnet, where `intents.near` lives. */
export const NEAR_INTENTS_NETWORK = "near:mainnet";

/**
 * Where a Sweep stands:
 *
 * - `planned`: Herald built the payload; the Provider hasn't signed it yet.
 * - `awaiting_signature`: the Provider's wallet sent the NEAR transaction
 *   asking the MPC signer to sign it; Herald waits for the signature.
 * - `submitted`: Herald submitted the signed transfer through the chain
 *   queue.
 * - `confirmed`: the transfer landed on-chain. A same-chain Sweep is done.
 * - `delivering`: 1Click has the deposit and is delivering it.
 * - `delivered`: 1Click delivered to the destination (`deliveredAmount`).
 * - `refunded`: 1Click refunded the deposit to the source Receiving
 *   Address (`refundedAmount`); `error` says why.
 * - `failed`: it didn't, and won't; `error` says why.
 */
export const SweepStatusSchema = z.enum([
  "planned",
  "awaiting_signature",
  "submitted",
  "confirmed",
  "delivering",
  "delivered",
  "refunded",
  "failed",
]);
export type SweepStatus = z.infer<typeof SweepStatusSchema>;

const Hex32Schema = z.string().regex(/^0x[0-9a-f]{64}$/, "Expected 32 bytes of lowercase hex");

const BaseUnitsSchema = z.string().regex(/^\d+$/);

/**
 * What every Sweep records, whatever its source chain.
 *
 * `destinationAddress` is where the funds end up: an address on
 * `destinationNetwork`, or for an `intents` Sweep the NEAR Intents account.
 * The `oneClick*` and `quote*` fields are the 1Click quote of a
 * `cross_chain` or `intents` Sweep, null for a `same_chain` one: the
 * transfer goes to `oneClickDepositAddress` instead, and 1Click delivers
 * `destinationAsset` (its asset id). `quoteAmountOut` is what the quote
 * expected to deliver, `deliveredAmount` and `refundedAmount` what 1Click
 * reported, and `deliveryTxHash` its delivery on the destination chain.
 * `nearTxHash` is the NEAR transaction holding the Sweep's MPC `sign` call;
 * `nearTxRelayer` is Herald's NEAR relayer when it sent that transaction
 * and paid its gas (a sponsored Sweep, ADR 0010), null when the Provider's
 * wallet did.
 */
const sweepFields = {
  id: z.number().int().positive(),
  providerId: z.number().int().positive(),
  sourceNetwork: Caip2Schema,
  asset: z.string().min(1),
  amount: BaseUnitsSchema,
  destinationKind: SweepDestinationKindSchema,
  destinationNetwork: Caip2Schema,
  destinationAddress: z.string().min(1),
  destinationAsset: z.string().min(1).nullable(),
  oneClickQuoteId: z.string().min(1).nullable(),
  oneClickDepositAddress: z.string().min(1).nullable(),
  oneClickSignature: z.string().min(1).nullable(),
  quoteAmountOut: BaseUnitsSchema.nullable(),
  quoteMinAmountOut: BaseUnitsSchema.nullable(),
  quoteRefundFee: BaseUnitsSchema.nullable(),
  quoteTimeEstimate: z.number().int().nonnegative().nullable(),
  quoteDeadline: z.date().nullable(),
  deliveredAmount: BaseUnitsSchema.nullable(),
  refundedAmount: BaseUnitsSchema.nullable(),
  deliveryTxHash: z.string().min(1).nullable(),
  validBefore: z.number().int().positive(),
  nearTxHash: z.string().nullable(),
  nearTxRelayer: z.string().nullable(),
  sourceTxHash: z.string().nullable(),
  status: SweepStatusSchema,
  error: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  submittedAt: z.date().nullable(),
};

/**
 * A Sweep from the EVM Receiving Address: an EIP-3009
 * `transferWithAuthorization` with `authorizationNonce`, valid strictly
 * between `validAfter` and `validBefore` (Unix seconds), whose EIP-712 hash
 * is `payloadHash`. `sourceTxHash` is the transfer's transaction hash.
 */
export const EvmSweepSchema = z.object({
  ...sweepFields,
  sourceKind: z.literal("evm"),
  authorizationNonce: Hex32Schema,
  validAfter: z.number().int().nonnegative(),
  payloadHash: Hex32Schema,
});
export type EvmSweep = z.infer<typeof EvmSweepSchema>;

/**
 * A Sweep from the Solana Receiving Address: `solanaTransaction`, an
 * unsigned SPL transfer (base64 wire format) whose fee payer is Herald's
 * Solana gas wallet. Its message is what the MPC signer signs. It can land
 * up to block height `lastValidBlockHeight`, which `validBefore` (Unix
 * seconds) estimates. `sourceTxHash` is the transaction's signature.
 */
export const SolanaSweepSchema = z.object({
  ...sweepFields,
  sourceKind: z.literal("solana"),
  solanaTransaction: z.string().min(1),
  lastValidBlockHeight: z.number().int().nonnegative(),
});
export type SolanaSweep = z.infer<typeof SolanaSweepSchema>;

/**
 * A Sweep from the NEAR Receiving Address: `nearDelegateAction`, an
 * unsigned NEP-366 delegate action (base64 Borsh, without the NEP-461
 * prefix) holding one USDC `ft_transfer`, with the access-key nonce
 * `nearNonce`, landing up to block `nearMaxBlockHeight`, which
 * `validBefore` (Unix seconds) estimates. `payloadHash` is its NEP-461
 * hash, what the MPC signer signs. `sourceTxHash` is the relayer
 * transaction that carries it.
 */
export const NearSweepSchema = z.object({
  ...sweepFields,
  sourceKind: z.literal("near"),
  nearDelegateAction: z.string().min(1),
  nearNonce: z.number().int().nonnegative(),
  nearMaxBlockHeight: z.number().int().nonnegative(),
  payloadHash: Hex32Schema,
});
export type NearSweep = z.infer<typeof NearSweepSchema>;

/**
 * A Sweep: moving `amount` (base units of `asset`) out of a Provider's
 * Receiving Address on `sourceNetwork`, an EVM, Solana or NEAR one
 * (`sourceKind`). `packages/db` keeps the `sweeps` table in line with this
 * schema: one table, with the other kinds' columns null.
 */
export const SweepSchema = z.discriminatedUnion("sourceKind", [
  EvmSweepSchema,
  SolanaSweepSchema,
  NearSweepSchema,
]);
export type Sweep = z.infer<typeof SweepSchema>;
