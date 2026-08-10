import { index, onchainEnum, onchainTable, primaryKey, relations } from "ponder";

export const agent = onchainTable(
  "agents",
  (t) => ({
    id: t.varchar().primaryKey(),
    chainId: t.varchar("chain_id").$type<`${string}:${string}`>().notNull(),
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
    chainIdIdx: index("agents_chain_id_idx").on(t.chainId),
  })
);

export const agentRelations = relations(agent, ({ many }) => ({
  apiServices: many(agentApiService),
  mcpServices: many(agentMcpService),
}));

export const apiMethod = onchainEnum("api_method", ["GET", "POST", "PATCH", "PUT", "DELETE"]);

export const agentApiService = onchainTable(
  "agent_api_services",
  (t) => ({
    agentId: t.varchar().notNull(),
    serviceId: t.varchar().notNull(),
    method: apiMethod().notNull(),
    endpoint: t.text().notNull(),
    name: t.text().notNull(),
    description: t.text().notNull(),
    fee: t.numeric().notNull(),
  }),
  (t) => ({
    agentApiServicePk: primaryKey({
      name: "agent_api_services_pk",
      columns: [t.agentId, t.serviceId, t.method, t.endpoint],
    }),
  })
);

export const agentApiServiceRelations = relations(agentApiService, ({ one }) => ({
  agent: one(agent, { fields: [agentApiService.agentId], references: [agent.id] }),
}));

export const mcpType = onchainEnum("mcp_type", ["tool", "prompt", "resource"]);

export const agentMcpService = onchainTable(
  "agent_mcp_services",
  (t) => ({
    agentId: t.varchar().notNull(),
    serviceId: t.varchar().notNull(),
    endpoint: t.text().notNull(),
    type: mcpType().notNull(),
    name: t.text().notNull(),
    description: t.text().notNull(),
    fee: t.numeric().notNull(),
  }),
  (t) => ({
    agentMcpServicePk: primaryKey({
      name: "agent_mcp_services_pk",
      columns: [t.agentId, t.serviceId, t.type, t.endpoint],
    }),
  })
);

export const agentMcpServiceRelations = relations(agentMcpService, ({ one }) => ({
  agent: one(agent, { fields: [agentMcpService.agentId], references: [agent.id] }),
}));
