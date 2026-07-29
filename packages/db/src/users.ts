import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { timestamps } from "@ivanius.ai/db/utils";

export const userWallets = sqliteTable("user_wallets", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  circleWalletId: text("circle_wallet_id").unique(),
  ...timestamps,
});

export type UserWallet = typeof userWallets.$inferSelect;
export type NewUserWallet = typeof userWallets.$inferInsert;
