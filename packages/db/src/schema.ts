import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Each table mirrors a Zod schema in @herald/core, which is the source of
// truth for domain types. Change both together; the db tests parse rows read
// back from D1 with the core schema.

/** Mirrors `ProviderSchema`. */
export const providers = sqliteTable("providers", {
  id: integer().primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull().unique(),
  evmAddress: text("evm_address").notNull(),
  solanaAddress: text("solana_address").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
