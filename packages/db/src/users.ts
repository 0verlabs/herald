import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestamps } from "@ivanius.ai/db/utils";

export const userWallets = sqliteTable(
  "user_wallets",
  {
    userId: text("user_id").notNull(),
    chain: text("chain").notNull(),
    walletId: text("wallet_id").unique().notNull(),
    walletAddress: text("wallet_address").unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.chain] })]
);
