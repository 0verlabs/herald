import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestamps } from "@ivanius.ai/db/utils";

import { networks } from "./networks";

export const userWallets = sqliteTable(
  "user_wallets",
  {
    userId: text("user_id").notNull(),
    network: text("network", { enum: networks }).notNull(),
    walletAddress: text("wallet_address").unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.network] })]
);
