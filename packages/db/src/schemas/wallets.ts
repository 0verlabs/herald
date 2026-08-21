import { supportedNetworks } from "@hrld/core";
import { primaryKey, varchar } from "drizzle-orm/pg-core";

import { appSchema } from "../schema";
import { timestamps } from "../utils/timestamps";

export const wallets = appSchema.table(
  "wallets",
  {
    user_id: varchar().notNull(),
    network: varchar({ enum: supportedNetworks }).notNull(),
    address: varchar().unique().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.user_id, table.network] })]
);
