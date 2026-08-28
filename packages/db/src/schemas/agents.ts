import { supportedChains } from "@hrld/core";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, text, unique, varchar } from "drizzle-orm/pg-core";

import { appSchema } from "../schema";
import { timestamps } from "../utils/timestamps";

export const agents = appSchema.table(
  "agents",
  {
    id: varchar().primaryKey(),
    chain: varchar({ enum: supportedChains }).notNull(),
    agent_id: bigint({ mode: "number" }).notNull(),
    name: text().notNull(),
    description: text().notNull(),
    image: text().notNull().default(""),
    category: varchar().notNull().default(""),
    score: integer().notNull().default(0),
    feedback_counts: integer().notNull().default(0),
    wallet: varchar().notNull().default(""),
    owner: varchar().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("agents_chain_agent_id_unique").on(t.chain, t.agent_id),
    index("agents_chain_idx").on(t.chain),
    index("agents_category_idx").on(t.chain, t.category),
    index("agents_chain_score_idx").on(t.chain, t.score.desc()),
    index("agents_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("agents_description_trgm_idx").using("gin", sql`${t.description} gin_trgm_ops`),
    check("agents_score_range", sql`${t.score} >= 0 and ${t.score} <= 100`),
    check("agents_feedback_counts_nonnegative", sql`${t.feedback_counts} >= 0`),
  ]
);
