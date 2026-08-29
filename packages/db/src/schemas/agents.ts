import { supportedChains } from "@hrld/core";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, text, unique, varchar } from "drizzle-orm/pg-core";
import { v7 } from "uuid";

import { appSchema } from "../schema";
import { timestamps } from "../utils/timestamps";

export const agents = appSchema.table(
  "agents",
  {
    id: varchar().primaryKey(),
    chain: varchar({ enum: supportedChains }).notNull(),
    onchain_id: bigint({ mode: "number" }).notNull(),
    name: text().notNull(),
    description: text().notNull(),
    image: text().notNull(),
    category: varchar(),
    score: integer().notNull().default(0),
    feedback_counts: integer().notNull().default(0),
    wallet: varchar(),
    owner: varchar().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("agents_chain_onchain_id_unique").on(t.chain, t.onchain_id),
    index("agents_chain_idx").on(t.chain),
    index("agents_category_idx").on(t.chain, t.category),
    index("agents_chain_score_idx").on(t.chain, t.score.desc()),
    index("agents_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("agents_description_trgm_idx").using("gin", sql`${t.description} gin_trgm_ops`),
    check("agents_score_range", sql`${t.score} >= 0 and ${t.score} <= 100`),
    check("agents_feedback_counts_nonnegative", sql`${t.feedback_counts} >= 0`),
  ]
);

export const agentJobServices = appSchema.table(
  "agent_job_services",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: t
      .varchar()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: t.text().notNull(),
    description: t.text().notNull(),
  }),
  (t) => [
    index("agent_job_services_agent_id_idx").on(t.agent_id),
    index("agent_job_services_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
    index("agent_job_services_description_trgm_idx").using(
      "gin",
      sql`${t.description} gin_trgm_ops`
    ),
  ]
);

export const agentApiServices = appSchema.table(
  "agent_api_services",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: t
      .varchar()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: t.text().notNull(),
    method: t.varchar().notNull(),
    endpoint: t.text().notNull(),
    version: t.varchar().notNull(),
    description: t.text().notNull(),
  }),
  (t) => [
    index("agent_api_services_agent_id_idx").on(t.agent_id),
    index("agent_api_services_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("agent_api_services_method_trgm_idx").using("gin", sql`${t.method} gin_trgm_ops`),
    index("agent_api_services_description_trgm_idx").using(
      "gin",
      sql`${t.description} gin_trgm_ops`
    ),
  ]
);

export const agentMcpServices = appSchema.table(
  "agent_mcp_services",
  (t) => ({
    id: t
      .varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: t
      .varchar()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    endpoint: t.text().notNull(),
    version: t.varchar().notNull(),
    tools: t.varchar().array().default([]),
    resources: t.varchar().array().default([]),
    prompts: t.varchar().array().default([]),
  }),
  (t) => [
    index("agent_mcp_services_agent_id_idx").on(t.agent_id),
    index("agent_mcp_services_tools_trgm_idx").using(
      "gin",
      sql`array_to_string(${t.tools}, ' ') gin_trgm_ops`
    ),
    index("agent_mcp_services_resources_trgm_idx").using(
      "gin",
      sql`array_to_string(${t.resources}, ' ') gin_trgm_ops`
    ),
    index("agent_mcp_services_prompts_trgm_idx").using(
      "gin",
      sql`array_to_string(${t.prompts}, ' ') gin_trgm_ops`
    ),
  ]
);
