import { index, onchainTable } from "ponder";
import { v7 } from "uuid";

export const agent = onchainTable(
  "agents",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    chain: t.varchar().notNull(),
    agent_id: t.varchar().notNull(),
    name: t.text().notNull(),
    description: t.text().notNull(),
    image: t.text(),
    active: t.boolean().default(true),
    x402_support: t.boolean().default(false),
    tags: t.varchar().array().default([]),
    score: t.integer().default(0),
    feedback_counts: t.integer().default(0),
    supported_trusts: t.varchar().array().default([]),
    wallet: t.varchar(),
    owner: t.varchar().notNull(),
  }),
  (t) => ({
    chainIdx: index("agents_chain_idx").on(t.chain),
    agentIdIdx: index("agents_agent_id_idx").on(t.agent_id),
    chainAgentIdIdx: index("agents_chain_agent_id_idx").on(t.chain, t.agent_id),
  })
);

export const agentApiService = onchainTable(
  "agent_api_services",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: t.varchar().notNull(),
    name: t.text().notNull(),
    method: t.varchar().notNull(),
    endpoint: t.text().notNull(),
    version: t.varchar().notNull(),
    description: t.text(),
  }),
  (t) => ({
    agentIdIdx: index("agent_api_services_agent_id_idx").on(t.agent_id),
  })
);

export const agentMcpService = onchainTable(
  "agent_mcp_services",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: t.varchar().notNull(),
    endpoint: t.text().notNull(),
    version: t.varchar().notNull(),
    tools: t.varchar().array(),
    resources: t.varchar().array(),
    prompts: t.varchar().array(),
    capabilities: t.varchar().array(),
  }),
  (t) => ({
    agentIdIdx: index("agent_mcp_services_agent_id_idx").on(t.agent_id),
  })
);
