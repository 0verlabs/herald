import type { AgentId, ProofOfPayment } from "@hrld/core";
import {
  bigint,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { v7 } from "uuid";

import { timestamps } from "../utils/timestamps";
import { agents } from "./agents";

export const agentFeedback = pgTable(
  "agent_feedback",
  {
    id: varchar()
      .primaryKey()
      .$defaultFn(() => v7()),
    agent_id: varchar()
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" })
      .$type<AgentId>(),
    client_address: varchar().notNull(),
    feedback_index: bigint({ mode: "number" }).notNull(),
    value: doublePrecision().notNull(),
    reasoning: text(),
    proof_of_payment: jsonb().$type<ProofOfPayment>(),
    revoked_at: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("agent_feedback_agent_client_index_unique").on(
      t.agent_id,
      t.client_address,
      t.feedback_index
    ),
  ]
);
