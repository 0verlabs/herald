import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Each table mirrors a Zod schema in @herald/core, which is the source of
// truth for domain types. Change both together; core parses every row it
// reads back with its schema.

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/** Mirrors `ProviderSchema`. */
export const providers = sqliteTable("providers", {
  id: integer().primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull().unique(),
  evmAddress: text("evm_address").notNull(),
  solanaAddress: text("solana_address").notNull(),
  solanaTokenAccountStatus: text("solana_token_account_status", {
    enum: ["not_queued", "queued", "created", "failed"],
  })
    .notNull()
    .default("not_queued"),
  createdAt: createdAt(),
});

/**
 * Mirrors `ApiKeySchema`. Only the SHA-256 hash of a key and a display
 * prefix are stored; the key itself is shown once, when it is issued.
 */
export const apiKeys = sqliteTable("api_keys", {
  id: integer().primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providers.id),
  env: text({ enum: ["testnet", "mainnet"] }).notNull(),
  prefix: text().notNull(),
  hash: text().notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

/**
 * Sign-in nonces the dashboard has issued and not yet used. Signing in
 * deletes the nonce it signed, so each one works once. Internal to sign-in,
 * so no core schema mirrors it.
 */
export const signInNonces = sqliteTable("sign_in_nonces", {
  /** The 32 random bytes the wallet signs, base64-encoded. */
  nonce: text().primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Mirrors `PaymentSchema`: one row per settled Buyer payment. */
export const payments = sqliteTable(
  "payments",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    apiKeyId: integer("api_key_id")
      .notNull()
      .references(() => apiKeys.id),
    network: text().notNull(),
    asset: text().notNull(),
    /** Base units of `asset`, as a decimal string. */
    amount: text().notNull(),
    buyerAddress: text("buyer_address").notNull(),
    txHash: text("tx_hash").notNull(),
    resourceUrl: text("resource_url"),
    settledAt: integer("settled_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("payments_network_tx_hash_unique").on(table.network, table.txHash)],
);

/**
 * Mirrors `SweepMinimumSchema`: the smallest amount of an asset a Provider
 * may Sweep from a network, in base units. Seeded from
 * `docs/research/stack-and-minimums.md`; admins edit it.
 */
export const sweepMinimums = sqliteTable(
  "sweep_minimums",
  {
    network: text().notNull(),
    asset: text().notNull(),
    /** Base units of `asset`, as a decimal string. */
    minimum: text().notNull(),
    note: text().notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.network, table.asset] })],
);

/**
 * Mirrors `SweepSchema`: one row per Sweep a Provider planned, with the
 * columns of its `source_kind` set and the other kind's left null.
 *
 * - `evm`: an EIP-3009 `transferWithAuthorization` from the Receiving
 *   Address; `payload_hash` is its EIP-712 hash.
 * - `solana`: an SPL transfer from the Receiving Address's USDC token
 *   account; `solana_transaction` is the unsigned transaction, whose message
 *   is the payload.
 *
 * The Provider's NEAR wallet asks the MPC signer to sign the payload in the
 * NEAR transaction `near_tx_hash`.
 */
export const sweeps = sqliteTable(
  "sweeps",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    sourceKind: text("source_kind", { enum: ["evm", "solana"] }).notNull(),
    sourceNetwork: text("source_network").notNull(),
    asset: text().notNull(),
    /** Base units of `asset`, as a decimal string. */
    amount: text().notNull(),
    destinationKind: text("destination_kind", { enum: ["same_chain"] }).notNull(),
    destinationNetwork: text("destination_network").notNull(),
    destinationAddress: text("destination_address").notNull(),
    /** EVM: the EIP-3009 authorization nonce, 32 bytes as 0x-prefixed hex. */
    authorizationNonce: text("authorization_nonce"),
    /** EVM: Unix seconds; the authorization is valid strictly between this and `valid_before`. */
    validAfter: integer("valid_after"),
    /**
     * Unix seconds. EVM: the authorization's expiry. Solana: when the
     * transaction's blockhash is expected to expire (`last_valid_block_height`
     * is the exact limit).
     */
    validBefore: integer("valid_before").notNull(),
    /** EVM: the EIP-712 hash of the authorization. */
    payloadHash: text("payload_hash"),
    /** Solana: the unsigned transaction, base64 wire format. */
    solanaTransaction: text("solana_transaction"),
    /** Solana: the last block height at which the transaction can land. */
    lastValidBlockHeight: integer("last_valid_block_height"),
    nearTxHash: text("near_tx_hash").unique(),
    sourceTxHash: text("source_tx_hash"),
    status: text({
      enum: ["planned", "awaiting_signature", "submitted", "confirmed", "failed"],
    })
      .notNull()
      .default("planned"),
    error: text(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("sweeps_provider_created").on(table.providerId, table.createdAt),
    index("sweeps_provider_submitted").on(table.providerId, table.submittedAt),
  ],
);
