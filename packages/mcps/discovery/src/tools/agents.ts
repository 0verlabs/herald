import type { AppType } from "@hrld/api/rpc";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { hc } from "hono/client";
import { z } from "zod";

import { json } from "../lib/json";

export function registerSearchAgents(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Search ERC-8004 agents indexed by Herald. Free-text search across agent name, description, and API service names/descriptions; matches exact substrings plus fuzzy near-matches like typos.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            "Free-text query across agent name, description, and API service names/descriptions"
          ),
        category: z.string().optional().describe("Exact category match"),
        chain: z
          .enum(["0g", "0g-testnet"])
          .optional()
          .describe("Chain to search on; defaults to 0g"),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum results per page"),
        cursor: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Offset pagination cursor; pass nextCursor from the previous call"),
      },
    },
    async ({ query, category, chain, limit, cursor }) => {
      const res = await api.agents.$get({
        query: {
          q: query,
          ...(category ? { category } : {}),
          ...(chain ? { chain } : {}),
          limit: String(limit),
          cursor: String(cursor),
        },
      });

      if (!res.ok)
        return {
          ...json({ error: `Agent search failed with status ${res.status}` }),
          isError: true,
        };

      return json(await res.json());
    }
  );
}

export function registerGetAgent(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  server.registerTool(
    "get_agent",
    {
      title: "Get agent",
      description: "Get a single ERC-8004 agent by its on-chain tokenId.",
      inputSchema: {
        agentId: z.string().describe("ERC-8004 tokenId of the agent"),
      },
    },
    async ({ agentId }) => {
      const res = await api.agents[":agentId"].$get({ param: { agentId } });

      if (!res.ok) return { ...json({ error: `Agent ${agentId} not found` }), isError: true };

      return json(await res.json());
    }
  );
}

export function registerListAgentServices(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
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
      const [apiRes, mcpRes] = await Promise.all([
        api.agents[":agentId"].services.api.$get({ param: { agentId }, query: {} }),
        api.agents[":agentId"].services.mcp.$get({ param: { agentId }, query: {} }),
      ]);

      if (!apiRes.ok || !mcpRes.ok)
        return {
          ...json({ error: `Failed to list services for agent ${agentId}` }),
          isError: true,
        };

      const [{ services: apiServices }, { services: mcpServices }] = await Promise.all([
        apiRes.json(),
        mcpRes.json(),
      ]);

      return json({ apiServices, mcpServices });
    }
  );
}

export function registerAgentTools(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  registerSearchAgents(server, api);
  registerGetAgent(server, api);
  registerListAgentServices(server, api);
}
