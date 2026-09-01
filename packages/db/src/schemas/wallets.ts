import { supportedNetworks } from "@hrld/core";
import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { v7 } from "uuid";

import { timestamps } from "../utils/timestamps";

export const wallets = pgTable(
  "wallets",
  {
    id: varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    user_id: varchar().notNull(),
    network: varchar({ enum: supportedNetworks }).notNull(),
    address: varchar().unique().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("wallets_user_id_network_unique_idx").on(t.user_id, t.network)]
);
