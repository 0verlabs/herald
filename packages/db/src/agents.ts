import { index, integer, pgTable, text, varchar } from "drizzle-orm/pg-core";

export const agents = pgTable(
  "agents",
  {
    id: varchar().primaryKey(),
    chain: varchar().notNull(),
    onchain_agent_id: varchar().notNull(),
    name: text().notNull(),
    description: text().notNull(),
    image: text(),
    tags: varchar().array().default([]),
    score: integer().default(0),
    feedback_counts: integer().default(0),
    supported_trusts: varchar().array().default([]),
    wallet: varchar(),
    owner: varchar().notNull(),
  },
  (table) => [
    index("agents_chain_idx").on(table.chain),
    index("agents_onchain_agent_id_idx").on(table.onchain_agent_id),
  ]
);
