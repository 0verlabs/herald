import type { SQL } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import {
  agentApiServiceSchema,
  agentIdCodec,
  agentJobServiceSchema,
  agentMcpServiceSchema,
  agentSchema,
  chainSchema,
} from "@hrld/core";
import * as schema from "@hrld/db";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { buildTextSearch } from "../lib/db";
import { notFound, ok } from "../utils/response";

const listAgentsQuery = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  chain: chainSchema.default("0g"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const getAgentByIdParam = z.object({
  agentId: z.string(),
});

const listServicesQuery = z.object({
  q: z.string().optional(),
  agentId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const agents = new Hono<{ Variables: GlobalVariables }>()
  .get("/", zValidator("query", listAgentsQuery), async (c) => {
    const db = c.var.db;
    const { q, category, chain, limit, offset } = c.req.valid("query");

    const conditions: SQL[] = [eq(schema.agents.active, true), eq(schema.agents.chain, chain)];

    if (category) conditions.push(eq(schema.agents.category, category));

    const search = q
      ? buildTextSearch([schema.agents.name, schema.agents.description], q)
      : undefined;
    if (search) conditions.push(search.match);

    // Fetch one extra row past the page boundary to know whether another
    // page exists, without a separate count query.
    const rows = await db
      .select()
      .from(schema.agents)
      .where(and(...conditions))
      .orderBy(
        ...(search ? [search.relevance] : []),
        desc(schema.agents.score),
        asc(schema.agents.id)
      )
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;

    const data = agentSchema
      .omit({ serviceCounts: true })
      .array()
      .parse(
        rows.slice(0, limit).map((row) => {
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
      next: hasMore ? offset + limit : null,
    });
  })
  .get("/services/job", zValidator("query", listServicesQuery), async (c) => {
    const db = c.var.db;
    const { agentId, q, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(schema.agentJobServices.agent_id, agentId));

    const search = q
      ? buildTextSearch([schema.agentJobServices.title, schema.agentJobServices.description], q)
      : undefined;
    if (search) conditions.push(search.match);

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select()
        .from(schema.agentJobServices)
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentJobServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(schema.agentJobServices).where(where),
    ]);

    const data = agentJobServiceSchema.array().parse(
      rows.map((row) => ({
        id: row.id,
        name: "JOB" as const,
        title: row.title,
        description: row.description,
      }))
    );

    return ok(c, {
      data,
      total,
    });
  })
  .get("/services/api", zValidator("query", listServicesQuery), async (c) => {
    const db = c.var.db;
    const { agentId, q, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(schema.agentApiServices.agent_id, agentId));

    const search = q
      ? buildTextSearch([schema.agentApiServices.name, schema.agentApiServices.description], q)
      : undefined;
    if (search) conditions.push(search.match);

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select()
        .from(schema.agentApiServices)
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentApiServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(schema.agentApiServices).where(where),
    ]);

    const data = agentApiServiceSchema.array().parse(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        method: row.method,
        endpoint: row.endpoint,
        version: row.version,
        description: row.description,
      }))
    );

    return ok(c, {
      data,
      total,
    });
  })
  .get("/services/mcp", zValidator("query", listServicesQuery), async (c) => {
    const db = c.var.db;
    const { agentId, q, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(schema.agentMcpServices.agent_id, agentId));

    const search = q
      ? buildTextSearch(
          [
            sql`array_to_string(${schema.agentMcpServices.tools}, ' ')`,
            sql`array_to_string(${schema.agentMcpServices.resources}, ' ')`,
            sql`array_to_string(${schema.agentMcpServices.prompts}, ' ')`,
          ],
          q
        )
      : undefined;
    if (search) conditions.push(search.match);

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select()
        .from(schema.agentMcpServices)
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentMcpServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(schema.agentMcpServices).where(where),
    ]);

    const data = agentMcpServiceSchema.array().parse(
      rows.map((row) => ({
        id: row.id,
        name: "MCP" as const,
        endpoint: row.endpoint,
        version: row.version,
        tools: row.tools ?? [],
        resources: row.resources ?? [],
        prompts: row.prompts ?? [],
      }))
    );

    return ok(c, {
      data,
      total,
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

    const [[jobCounts = { total: 0 }], [apiCounts = { total: 0 }], [mcpCounts = { total: 0 }]] =
      await Promise.all([
        c.var.db
          .select({ total: count(schema.agentJobServices.id) })
          .from(schema.agentJobServices)
          .where(eq(schema.agentJobServices.agent_id, agentId)),
        c.var.db
          .select({ total: count(schema.agentApiServices.id) })
          .from(schema.agentApiServices)
          .where(eq(schema.agentApiServices.agent_id, agentId)),
        c.var.db
          .select({ total: count(schema.agentMcpServices.id) })
          .from(schema.agentMcpServices)
          .where(eq(schema.agentMcpServices.agent_id, agentId)),
      ]);

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
      serviceCounts: {
        job: jobCounts.total,
        api: apiCounts.total,
        mcp: mcpCounts.total,
      },
      wallet: record.wallet,
      owner: record.owner,
    });

    return ok(c, agent);
  });
