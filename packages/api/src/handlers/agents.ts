import type { AgentId } from "@hrld/core";
import type { SQL } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import {
  agentApiServiceSchema,
  agentIdCodec,
  agentJobServiceSchema,
  agentMcpServiceSchema,
  agentSchema,
  agentSummarySchema,
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
  chain: chainSchema.default("0g"),
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
            category: row.category,
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
    const { agentId, q, chain, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [eq(schema.agents.chain, chain)];
    if (agentId) conditions.push(eq(schema.agentJobServices.agent_id, agentId as AgentId));

    const search = q
      ? buildTextSearch([schema.agentJobServices.title, schema.agentJobServices.description], q)
      : undefined;
    if (search) conditions.push(search.match);

    const where = and(...conditions);

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select({
          agent_job_services: {
            id: schema.agentJobServices.id,
            title: schema.agentJobServices.title,
            description: schema.agentJobServices.description,
          },
          agent: {
            id: schema.agents.id,
            chain: schema.agents.chain,
            onchain_id: schema.agents.onchain_id,
            name: schema.agents.name,
            description: schema.agents.description,
            image: schema.agents.image,
            score: schema.agents.score,
            feedback_counts: schema.agents.feedback_counts,
            owner: schema.agents.owner,
          },
        })
        .from(schema.agentJobServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentJobServices.agent_id))
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentJobServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(schema.agentJobServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentJobServices.agent_id))
        .where(where),
    ]);

    const data = agentJobServiceSchema
      .omit({
        agentId: true,
      })
      .extend({
        agent: agentSummarySchema,
      })
      .array()
      .parse(
        rows.map((row) => ({
          id: row.agent_job_services.id,
          name: "JOB" as const,
          title: row.agent_job_services.title,
          description: row.agent_job_services.description,
          agent: {
            id: row.agent.id,
            chain: row.agent.chain,
            onchainId: row.agent.onchain_id,
            name: row.agent.name,
            description: row.agent.description,
            image: row.agent.image,
            score: row.agent.score,
            feedbackCounts: row.agent.feedback_counts,
            owner: row.agent.owner,
          },
        }))
      );

    return ok(c, {
      data,
      total,
    });
  })
  .get("/services/api", zValidator("query", listServicesQuery), async (c) => {
    const db = c.var.db;
    const { agentId, q, chain, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [eq(schema.agents.chain, chain)];
    if (agentId) conditions.push(eq(schema.agentApiServices.agent_id, agentId as AgentId));

    const search = q
      ? buildTextSearch([schema.agentApiServices.name, schema.agentApiServices.description], q)
      : undefined;
    if (search) conditions.push(search.match);

    const where = and(...conditions);

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select({
          agent_api_services: {
            id: schema.agentApiServices.id,
            name: schema.agentApiServices.name,
            method: schema.agentApiServices.method,
            endpoint: schema.agentApiServices.endpoint,
            version: schema.agentApiServices.version,
            description: schema.agentApiServices.description,
          },
          agent: {
            id: schema.agents.id,
            chain: schema.agents.chain,
            onchain_id: schema.agents.onchain_id,
            name: schema.agents.name,
            description: schema.agents.description,
            image: schema.agents.image,
            score: schema.agents.score,
            feedback_counts: schema.agents.feedback_counts,
            owner: schema.agents.owner,
          },
        })
        .from(schema.agentApiServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentApiServices.agent_id))
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentApiServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(schema.agentApiServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentApiServices.agent_id))
        .where(where),
    ]);

    const data = agentApiServiceSchema
      .omit({
        agentId: true,
      })
      .extend({
        agent: agentSummarySchema,
      })
      .array()
      .parse(
        rows.map((row) => ({
          id: row.agent_api_services.id,
          name: row.agent_api_services.name,
          method: row.agent_api_services.method,
          endpoint: row.agent_api_services.endpoint,
          version: row.agent_api_services.version,
          description: row.agent_api_services.description,
          agent: {
            id: row.agent.id,
            chain: row.agent.chain,
            onchainId: row.agent.onchain_id,
            name: row.agent.name,
            description: row.agent.description,
            image: row.agent.image,
            score: row.agent.score,
            feedbackCounts: row.agent.feedback_counts,
            owner: row.agent.owner,
          },
        }))
      );

    return ok(c, {
      data,
      total,
    });
  })
  .get("/services/mcp", zValidator("query", listServicesQuery), async (c) => {
    const db = c.var.db;
    const { agentId, q, chain, page, limit } = c.req.valid("query");

    const conditions: SQL[] = [eq(schema.agents.chain, chain)];
    if (agentId) conditions.push(eq(schema.agentMcpServices.agent_id, agentId as AgentId));

    // Must match the expression the GIN trigram indexes are built on, otherwise
    // the planner falls back to a sequential scan.
    const search = q
      ? buildTextSearch(
          [
            sql`immutable_array_to_string(${schema.agentMcpServices.tools}, ' ')`,
            sql`immutable_array_to_string(${schema.agentMcpServices.resources}, ' ')`,
            sql`immutable_array_to_string(${schema.agentMcpServices.prompts}, ' ')`,
          ],
          q
        )
      : undefined;
    if (search) conditions.push(search.match);

    const where = and(...conditions);

    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select({
          agent_mcp_services: {
            id: schema.agentMcpServices.id,
            endpoint: schema.agentMcpServices.endpoint,
            version: schema.agentMcpServices.version,
            tools: schema.agentMcpServices.tools,
            resources: schema.agentMcpServices.resources,
            prompts: schema.agentMcpServices.prompts,
          },
          agent: {
            id: schema.agents.id,
            chain: schema.agents.chain,
            onchain_id: schema.agents.onchain_id,
            name: schema.agents.name,
            description: schema.agents.description,
            image: schema.agents.image,
            score: schema.agents.score,
            feedback_counts: schema.agents.feedback_counts,
            owner: schema.agents.owner,
          },
        })
        .from(schema.agentMcpServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentMcpServices.agent_id))
        .where(where)
        .orderBy(...(search ? [search.relevance] : []), asc(schema.agentMcpServices.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db
        .select({ total: count() })
        .from(schema.agentMcpServices)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.agentMcpServices.agent_id))
        .where(where),
    ]);

    const data = agentMcpServiceSchema
      .omit({
        agentId: true,
      })
      .extend({
        agent: agentSummarySchema,
      })
      .array()
      .parse(
        rows.map((row) => ({
          id: row.agent_mcp_services.id,
          name: "MCP" as const,
          endpoint: row.agent_mcp_services.endpoint,
          version: row.agent_mcp_services.version,
          tools: row.agent_mcp_services.tools ?? [],
          resources: row.agent_mcp_services.resources ?? [],
          prompts: row.agent_mcp_services.prompts ?? [],
          agent: {
            id: row.agent.id,
            chain: row.agent.chain,
            onchainId: row.agent.onchain_id,
            name: row.agent.name,
            description: row.agent.description,
            image: row.agent.image,
            score: row.agent.score,
            feedbackCounts: row.agent.feedback_counts,
            owner: row.agent.owner,
          },
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
      .where(eq(schema.agents.id, agentId as AgentId))
      .limit(1);

    if (!record) return notFound(c, { message: `Agent ${agentId} not found` });

    const [[jobCounts = { total: 0 }], [apiCounts = { total: 0 }], [mcpCounts = { total: 0 }]] =
      await Promise.all([
        c.var.db
          .select({ total: count(schema.agentJobServices.id) })
          .from(schema.agentJobServices)
          .where(eq(schema.agentJobServices.agent_id, agentId as AgentId)),
        c.var.db
          .select({ total: count(schema.agentApiServices.id) })
          .from(schema.agentApiServices)
          .where(eq(schema.agentApiServices.agent_id, agentId as AgentId)),
        c.var.db
          .select({ total: count(schema.agentMcpServices.id) })
          .from(schema.agentMcpServices)
          .where(eq(schema.agentMcpServices.agent_id, agentId as AgentId)),
      ]);

    const id = agentIdCodec.encode({ chain: record.chain, onchainId: record.onchain_id });

    const agent = agentSchema.parse({
      id,
      chain: record.chain,
      onchainId: record.onchain_id,
      name: record.name,
      description: record.description,
      image: record.image,
      category: record.category,
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
