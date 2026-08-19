import { index, onchainTable } from "ponder";

export const agent = onchainTable(
  "agents",
  (t) => ({
    // Canonical Agent Id: "<chain>:<onChainAgentId>", e.g. "0g-testnet:42".
    id: t.varchar().primaryKey(),
    chain: t.varchar().notNull(),
    onChainAgentId: t.bigint("on_chain_agent_id").notNull(),
    name: t.text().notNull(),
    description: t.text().notNull(),
    image: t.text(),
    tags: t.text().array().default([]),
    score: t.integer().default(0),
    feedbackCounts: t.integer("feedback_counts").default(0),
    wallet: t.varchar(),
    owner: t.varchar().notNull(),
  }),
  (t) => ({
    chainIdx: index("agents_chain_idx").on(t.chain),
  })
);
