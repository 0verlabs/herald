import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestamps } from "@ivanius.ai/db/utils";

export const networks = ["evm", "solana"] as const;
export type Network = (typeof networks)[number];

export const userWallets = sqliteTable(
  "user_wallets",
  {
    userId: text("user_id").notNull(),
    network: text("network", { enum: networks }).notNull(),
    circleWalletId: text("circle_wallet_id").unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.userId, table.network] })]
);

export type UserWallet = typeof userWallets.$inferSelect;
export type NewUserWallet = typeof userWallets.$inferInsert;
