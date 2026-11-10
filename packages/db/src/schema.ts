import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
