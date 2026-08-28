import type { AnyColumn, SQL } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { agentIdCodec, agentSchema, chainSchema } from "@hrld/core";
import * as schema from "@hrld/db";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { notFound, ok } from "../utils/response";

const TRIGRAM_SIMILARITY_THRESHOLD = 0.15;

const listAgentsQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  chain: chainSchema.default("0g"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const getAgentByIdParam = z.object({
  agentId: z.string(),
});

const listServicesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const agents = new Hono<{ Variables: GlobalVariables }>();

agents
  .get("/", zValidator("query", listAgentsQuery), async (c) => {
    const db = c.var.db;
    const { q, category, chain, limit, page } = c.req.valid("query");

    const conditions: SQL[] = [eq(schema.agents.active, true), eq(schema.agents.chain, chain)];

    if (category) conditions.push(eq(schema.agents.category, category));

    if (q) {
      const pattern = `%${q}%`;
      const fuzzy = (column: AnyColumn) =>
        sql`similarity(${column}, ${q}) > ${TRIGRAM_SIMILARITY_THRESHOLD}`;
      // ilike catches exact substrings (incl. short queries); similarity()
      // adds typo-tolerant trigram matching on top.
      const match = or(
        ilike(schema.agents.name, pattern),
        ilike(schema.agents.description, pattern),
        fuzzy(schema.agents.name),
        fuzzy(schema.agents.description)
      );
      if (match) conditions.push(match);
    }

    const relevance = q
      ? desc(
          sql`greatest(similarity(${schema.agents.name}, ${q}), similarity(${schema.agents.description}, ${q}))`
        )
      : undefined;

    const rows = await db
      .select()
      .from(schema.agents)
      .where(and(...conditions))
      .orderBy(...(relevance ? [relevance] : []), desc(schema.agents.score), asc(schema.agents.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ total }] = await db
      .select({
        total: sql<number>`count(${schema.agents.id})`,
      })
      .from(schema.agents)
      .where(and(...conditions))
      .orderBy(...(relevance ? [relevance] : []), desc(schema.agents.score), asc(schema.agents.id));

    const data = agentSchema.array().encode(
      rows.map((row) => {
        const id = agentIdCodec.encode({ chain: row.chain, onchainId: row.onchain_id });

        return {
          id,
          chain: row.chain,
          onchainId: row.onchain_id,
          name: row.name,
          description: row.description,
          image: row.image,
          category: row.category ?? "others",
          active: row.active,
          score: row.score,
          feedbackCounts: row.feedback_counts,
          wallet: row.wallet,
          owner: row.owner,
        };
      })
    );

    return ok(c, {
      data,
      total: total ?? 0,
    });
  })
  .get("/:agentId", zValidator("param", getAgentByIdParam), async (c) => {
    const { agentId } = c.req.valid("param");

    const [record] = await c.var.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!record) return notFound(c, { message: `Agent ${agentId} not found` });

    const id = agentIdCodec.encode({ chain: record.chain, onchainId: record.onchain_id });

    const agent = agentSchema.parse({
      id,
      chain: record.chain,
      onchainId: record.onchain_id,
      name: record.name,
      description: record.description,
      image: record.image,
      category: record.category ?? "others",
      active: record.active,
      score: record.score,
      feedbackCounts: record.feedback_counts,
      wallet: record.wallet,
      owner: record.owner,
    });

    return ok(c, agent);
  })
  .get(
    "/:agentId/services/api",
    zValidator("param", getAgentByIdParam),
    zValidator("query", listServicesQuery),
    async (c) => {
      const { page, limit } = c.req.valid("query");

      return ok(c, {
        data: [],
        total: 0,
      });
    }
  )
  .get(
    "/:agentId/services/mcp",
    zValidator("param", getAgentByIdParam),
    zValidator("query", listServicesQuery),
    async (c) => {
      const { page, limit } = c.req.valid("query");

      return ok(c, {
        data: [],
        total: 0,
      });
    }
  );
