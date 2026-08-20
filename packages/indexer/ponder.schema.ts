import { index, onchainTable } from "ponder";

export const agent = onchainTable(
  "agents",
  (t) => ({
    id: t.varchar().primaryKey(),
    chain: t.varchar().notNull(),
    onchain_agent_id: t.varchar().notNull(),
    name: t.text().notNull(),
    description: t.text().notNull(),
    image: t.text(),
    tags: t.varchar().array().default([]),
    score: t.integer().default(0),
    feedback_counts: t.integer().default(0),
    supported_trusts: t.varchar().array().default([]),
    wallet: t.varchar(),
    owner: t.varchar().notNull(),
  }),
  (t) => ({
    chainIdx: index("agents_chain_idx").on(t.chain),
    onchainAgentIdIdx: index("agents_onchain_agent_id_idx").on(t.onchain_agent_id),
  })
);
