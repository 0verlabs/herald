import { timestamps } from "@hrld/db/utils";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

import { networks } from "./networks";

export const userWallets = pgTable(
  "user_wallets",
  {
    userId: varchar("user_id").notNull(),
    network: varchar("network", { enum: networks }).notNull(),
    walletAddress: varchar("wallet_address").unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.network] })]
);
