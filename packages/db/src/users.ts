import { supportedNetworks } from "@hrld/core";
import { timestamps } from "@hrld/db/utils";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

export const userWallets = pgTable(
  "user_wallets",
  {
    user_id: varchar().notNull(),
    network: varchar({ enum: supportedNetworks }).notNull(),
    wallet_address: varchar().unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.user_id, table.network] })]
);
