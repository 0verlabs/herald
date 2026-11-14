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
  // Null only on rows from before the NEAR migration, until core derives
  // and stores it (see `providerFromRow` in @herald/core/server).
  nearAddress: text("near_address"),
  solanaTokenAccountStatus: text("solana_token_account_status", {
    enum: ["not_queued", "queued", "created", "failed"],
  })
    .notNull()
    .default("not_queued"),
  nearSetupStatus: text("near_setup_status", { enum: ["not_queued", "queued", "created"] })
    .notNull()
    .default("not_queued"),
  // The relayer transaction in which Herald created an implicit Provider
  // Account for its first sponsored Sweep (#50); null if Herald never did.
  providerAccountTxHash: text("provider_account_tx_hash"),
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
 * - `near`: a NEP-366 delegate action from the NEAR Receiving Address
 *   holding one USDC `ft_transfer`; `payload_hash` is its NEP-461 hash.
 *
 * The Provider's NEAR wallet asks the MPC signer to sign the payload in the
 * NEAR transaction `near_tx_hash`: sent by the wallet, or for a sponsored
 * Sweep by Herald's relayer `near_tx_relayer`, holding the wallet's signed
 * delegate action.
 *
 * A `cross_chain` or `intents` Sweep goes through 1Click: its transfer goes
 * to `one_click_deposit_address`, and the `quote_*` columns hold the quote.
 */
export const sweeps = sqliteTable(
  "sweeps",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id),
    sourceKind: text("source_kind", { enum: ["evm", "solana", "near"] }).notNull(),
    sourceNetwork: text("source_network").notNull(),
    asset: text().notNull(),
    /** Base units of `asset`, as a decimal string. */
    amount: text().notNull(),
    destinationKind: text("destination_kind", {
      enum: ["same_chain", "cross_chain", "intents"],
    }).notNull(),
    destinationNetwork: text("destination_network").notNull(),
    destinationAddress: text("destination_address").notNull(),
    /** 1Click kinds: the 1Click asset id 1Click delivers. */
    destinationAsset: text("destination_asset"),
    /** 1Click kinds: the quote's correlation id. */
    oneClickQuoteId: text("one_click_quote_id"),
    /** 1Click kinds: where the transfer goes, on the source network. */
    oneClickDepositAddress: text("one_click_deposit_address"),
    /** 1Click kinds: 1Click's signature of the quote, kept for disputes. */
    oneClickSignature: text("one_click_signature"),
    /** 1Click kinds: what the quote expected to deliver, base units of `destination_asset`. */
    quoteAmountOut: text("quote_amount_out"),
    /** 1Click kinds: the least it delivers after slippage. */
    quoteMinAmountOut: text("quote_min_amount_out"),
    /** 1Click kinds: what 1Click keeps if it refunds, base units of `asset`. */
    quoteRefundFee: text("quote_refund_fee"),
    /** 1Click kinds: seconds from the deposit's confirmation to delivery. */
    quoteTimeEstimate: integer("quote_time_estimate"),
    /** 1Click kinds: the deposit address goes inactive then; deposits after it may be lost. */
    quoteDeadline: integer("quote_deadline", { mode: "timestamp_ms" }),
    /** 1Click kinds: what 1Click reports it delivered. */
    deliveredAmount: text("delivered_amount"),
    /** 1Click kinds: what 1Click reports it refunded to the source Receiving Address. */
    refundedAmount: text("refunded_amount"),
    /** 1Click kinds: the delivery's transaction on the destination network. */
    deliveryTxHash: text("delivery_tx_hash"),
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
    /** EVM: the EIP-712 hash of the authorization. NEAR: the delegate action's NEP-461 hash. */
    payloadHash: text("payload_hash"),
    /** Solana: the unsigned transaction, base64 wire format. */
    solanaTransaction: text("solana_transaction"),
    /** Solana: the last block height at which the transaction can land. */
    lastValidBlockHeight: integer("last_valid_block_height"),
    /** NEAR: the unsigned NEP-366 delegate action, base64 Borsh (no NEP-461 prefix). */
    nearDelegateAction: text("near_delegate_action"),
    /** NEAR: the delegate action's nonce, above the Receiving Address key's. */
    nearNonce: integer("near_nonce"),
    /** NEAR: the last block height at which the delegate action can land. */
    nearMaxBlockHeight: integer("near_max_block_height"),
    nearTxHash: text("near_tx_hash").unique(),
    /**
     * A sponsored Sweep (ADR 0010): Herald's NEAR relayer, which sent
     * `near_tx_hash` holding the Provider's signed delegate action and paid
     * its gas. Null when the Provider's wallet sent it.
     */
    nearTxRelayer: text("near_tx_relayer"),
    /**
     * A sponsored Sweep: the first signed delegate action (base64 Borsh)
     * presented for it, the only one Herald's relayer sends for it (ADR
     * 0008). Taken before relaying; cleared when the relayer refused it,
     * sending nothing. Null for a Sweep the Provider's wallet sent.
     */
    sponsoredDelegateAction: text("sponsored_delegate_action"),
    sourceTxHash: text("source_tx_hash"),
    status: text({
      enum: [
        "planned",
        "awaiting_signature",
        "submitted",
        "confirmed",
        "delivering",
        "delivered",
        "refunded",
        "failed",
      ],
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
