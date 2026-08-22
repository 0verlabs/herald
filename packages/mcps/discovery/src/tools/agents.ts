import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SQL } from "drizzle-orm";
import { chainSchema } from "@hrld/core";
import { agent, agentApiService, agentMcpService } from "@hrld/indexer/schema";
import { and, arrayOverlaps, asc, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../lib/db";
import { json } from "../lib/json";

export function registerSearchAgents(server: McpServer) {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search ERC-8004 agents indexed by Herald. Filter by free-text query across name and description, tags, chain, x402 payment support, or an MCP capability matched against agent service tools and resources.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search across agent name and description"),
        tags: z.array(z.string()).optional().describe("Match agents having any of these tags"),
        chain: chainSchema.optional().describe("Restrict results to one chain"),
        x402Support: z.boolean().optional().describe("Only agents that support x402 payments"),
        capability: z
          .string()
          .optional()
          .describe("Match an MCP tool or resource exposed by one of the agent's services"),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum results per page"),
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Offset pagination cursor; pass nextCursor from the previous call"),
      },
    },
    async ({ query, tags, chain, x402Support, capability, limit, cursor }) => {
      const conditions: SQL[] = [eq(agent.active, true)];

      if (query) {
        const pattern = `%${query}%`;
        const match = or(ilike(agent.name, pattern), ilike(agent.description, pattern));
        if (match) conditions.push(match);
      }
      if (tags?.length) conditions.push(arrayOverlaps(agent.tags, tags));
      if (chain) conditions.push(eq(agent.chain, chain));
      if (x402Support) conditions.push(eq(agent.x402_support, true));
      if (capability) {
        const capabilityService = exists(
          db
            .select({ ok: sql`1` })
            .from(agentMcpService)
            .where(
              and(
                eq(agentMcpService.agent_id, agent.agent_id),
                or(
                  arrayOverlaps(agentMcpService.tools, [capability]),
                  arrayOverlaps(agentMcpService.resources, [capability])
                )
              )
            )
        );
        conditions.push(capabilityService);
      }

      const rows = await db
        .select()
        .from(agent)
        .where(and(...conditions))
        .orderBy(desc(agent.score), asc(agent.id))
        .limit(limit + 1)
        .offset(cursor);

      return json({
        agents: rows.slice(0, limit),
        nextCursor: rows.length > limit ? cursor + limit : null,
      });
    }
  );
}

export function registerGetAgent(server: McpServer) {
  server.registerTool(
    "get_agent",
    {
      title: "Get agent",
      description:
        "Get a single ERC-8004 agent by its on-chain tokenId and chain, including all of its registered API and MCP services.",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 tokenId of the agent"),
        chain: chainSchema.describe("Chain the agent is registered on"),
      },
    },
    async ({ agentId, chain }) => {
      const [record] = await db
        .select()
        .from(agent)
        .where(and(eq(agent.chain, chain), eq(agent.agent_id, agentId)))
        .limit(1);

      if (!record)
        return { ...json({ error: `Agent ${agentId} not found on ${chain}` }), isError: true };

      const apiServices = await db
        .select()
        .from(agentApiService)
        .where(eq(agentApiService.agent_id, record.agent_id));
      const mcpServices = await db
        .select()
        .from(agentMcpService)
        .where(eq(agentMcpService.agent_id, record.agent_id));

      return json({ ...record, apiServices, mcpServices });
    }
  );
}

export function registerListAgentServices(server: McpServer) {
  server.registerTool(
    "list_agent_services",
    {
      title: "List agent services",
      description:
        "List the API and MCP services an agent exposes. Services are keyed by the ERC-8004 tokenId; pass the same agentId you got from search_agents.",
      inputSchema: {
        agentId: z
          .string()
          .describe("ERC-8004 tokenId of the agent (agents.agent_id in the index)"),
      },
    },
    async ({ agentId }) => {
      const apiServices = await db
        .select()
        .from(agentApiService)
        .where(eq(agentApiService.agent_id, agentId));
      const mcpServices = await db
        .select()
        .from(agentMcpService)
        .where(eq(agentMcpService.agent_id, agentId));

      return json({ apiServices, mcpServices });
    }
  );
}

export function registerAgentTools(server: McpServer) {
  registerSearchAgents(server);
  registerGetAgent(server);
  registerListAgentServices(server);
}
