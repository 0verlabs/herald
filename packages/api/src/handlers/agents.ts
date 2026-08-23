import type { AnyColumn, SQL } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { agent, agentApiService, agentMcpService } from "@hrld/indexer/schema";
import { and, asc, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { notFound } from "../utils/response";

const TRIGRAM_SIMILARITY_THRESHOLD = 0.15;

const listAgentsQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
});

const listServicesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const agents = new Hono<{ Variables: GlobalVariables }>()
  .get("/", zValidator("query", listAgentsQuery), async (c) => {
    const db = c.var.db;
    const { q, limit, cursor } = c.req.valid("query");

    const conditions: SQL[] = [eq(agent.active, true)];

    if (q) {
      const pattern = `%${q}%`;
      const fuzzy = (column: AnyColumn) =>
        sql`similarity(${column}, ${q}) > ${TRIGRAM_SIMILARITY_THRESHOLD}`;
      // ilike catches exact substrings (incl. short queries); similarity()
      // adds typo-tolerant trigram matching on top.
      const match = or(
        ilike(agent.name, pattern),
        ilike(agent.description, pattern),
        fuzzy(agent.name),
        fuzzy(agent.description),
        exists(
          db
            .select({ ok: sql`1` })
            .from(agentApiService)
            .where(
              and(
                eq(agentApiService.agent_id, agent.agent_id),
                or(
                  ilike(agentApiService.name, pattern),
                  ilike(agentApiService.description, pattern),
                  fuzzy(agentApiService.name),
                  fuzzy(agentApiService.description)
                )
              )
            )
        )
      );
      if (match) conditions.push(match);
    }

    const relevance = q
      ? desc(sql`greatest(similarity(${agent.name}, ${q}), similarity(${agent.description}, ${q}))`)
      : undefined;

    const rows = await db
      .select()
      .from(agent)
      .where(and(...conditions))
      .orderBy(...(relevance ? [relevance] : []), desc(agent.score), asc(agent.id))
      .limit(limit + 1)
      .offset(cursor);

    return c.json({
      agents: rows.slice(0, limit),
      nextCursor: rows.length > limit ? cursor + limit : null,
    });
  })
  .get("/:agentId", async (c) => {
    const agentId = c.req.param("agentId");

    const [record] = await c.var.db
      .select()
      .from(agent)
      .where(eq(agent.agent_id, agentId))
      .limit(1);

    if (!record) return notFound(c, { message: `Agent ${agentId} not found` });

    return c.json(record);
  })
  .get("/:agentId/services/api", zValidator("query", listServicesQuery), async (c) => {
    const agentId = c.req.param("agentId");
    const { page, limit } = c.req.valid("query");

    const [{ count: total }] = await c.var.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentApiService)
      .where(eq(agentApiService.agent_id, agentId));

    const services = await c.var.db
      .select()
      .from(agentApiService)
      .where(eq(agentApiService.agent_id, agentId))
      .orderBy(asc(agentApiService.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return c.json({ services, pagination: { page, limit, total } });
  })
  .get("/:agentId/services/mcp", zValidator("query", listServicesQuery), async (c) => {
    const agentId = c.req.param("agentId");
    const { page, limit } = c.req.valid("query");

    const [{ count: total }] = await c.var.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentMcpService)
      .where(eq(agentMcpService.agent_id, agentId));

    const services = await c.var.db
      .select()
      .from(agentMcpService)
      .where(eq(agentMcpService.agent_id, agentId))
      .orderBy(asc(agentMcpService.id))
      .limit(limit)
      .offset((page - 1) * limit);

    return c.json({ services, pagination: { page, limit, total } });
  });
