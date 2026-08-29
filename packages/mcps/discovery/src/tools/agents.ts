import type { AppType } from "@hrld/api/rpc";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { hc } from "hono/client";
import { agentIdSchema, chainSchema } from "@hrld/core";
import { z } from "zod";

import { json } from "../lib/json";

export function registerSearchAgents(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  server.registerTool(
    "search_agents",
    {
      title: "Search agents",
      description:
        "Find ERC-8004 agents in Herald's index. The query matches substrings and typos in an agent's name and description. " +
        "Use this to find who can do something. Use search_services to find the specific job, API endpoint, or MCP tool an agent exposes. " +
        "Inactive agents are never returned. Results are ranked by how well they match, then by reputation score. " +
        "Read `next` from the response and pass it back as `offset` to get the following page. On the last page `next` is null.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Words to match against agent names and descriptions. Omit to list all agents"),
        category: z
          .string()
          .optional()
          .describe("Return only agents in this category. Matched exactly, no typo tolerance"),
        chain: chainSchema.optional().describe("Chain to search. Defaults to 0g"),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Results to skip. Pass the `next` value from the previous response"),
        limit: z.number().int().min(1).max(50).default(20).describe("Results per page, 1 to 50"),
      },
    },
    async ({ query, category, chain, limit, offset }) => {
      const res = await api.agents.$get({
        query: {
          ...(query ? { q: query } : {}),
          ...(category ? { category } : {}),
          ...(chain ? { chain } : {}),
          offset: String(offset),
          limit: String(limit),
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

export function registerSearchServices(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  server.registerTool(
    "search_services",
    {
      title: "Search agent services",
      description:
        "Find a specific service an agent offers, rather than the agent itself. `kind` decides which fields the query searches.\n" +
        "- job: titles and descriptions of work an agent performs on request.\n" +
        "- api: names and descriptions of REST endpoints an agent exposes.\n" +
        "- mcp: the tool, resource, and prompt names an agent's MCP server exposes.\n" +
        "The query matches substrings and typos. Every result carries a summary of the agent that offers it, " +
        "so you do not need to call get_agent afterwards. `total` is the full number of matches across all pages.",
      inputSchema: {
        kind: z
          .enum(["job", "api", "mcp"])
          .describe("Which kind of service to search. Each kind searches different fields"),
        query: z
          .string()
          .optional()
          .describe("Words to match against the fields listed for `kind`. Omit to list all"),
        agentId: agentIdSchema
          .optional()
          .describe("Return only services offered by this agent, for example 0g_12"),
        chain: chainSchema.optional().describe("Chain to search. Defaults to 0g"),
        page: z.coerce.number().int().min(1).default(1).describe("Page number, starting at 1"),
        limit: z.number().int().min(1).max(50).default(20).describe("Results per page, 1 to 50"),
      },
    },
    async ({ kind, query, agentId, chain, page, limit }) => {
      const endpoint = {
        job: api.agents.services.job,
        api: api.agents.services.api,
        mcp: api.agents.services.mcp,
      }[kind];

      const res = await endpoint.$get({
        query: {
          ...(query ? { q: query } : {}),
          ...(agentId ? { agentId } : {}),
          ...(chain ? { chain } : {}),
          page: String(page),
          limit: String(limit),
        },
      });

      if (!res.ok)
        return {
          ...json({ error: `Service search failed with status ${res.status}` }),
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
      title: "Get agent by ID",
      description:
        "Get one agent by id, including how many job, API, and MCP services it offers. " +
        "Use this when you already have an id from search_agents or search_services. " +
        "To search by name instead, use search_agents.",
      inputSchema: {
        agentId: agentIdSchema.describe(
          "Agent id, chain and onchain id joined by an underscore, for example 0g_12"
        ),
      },
    },
    async ({ agentId }) => {
      const res = await api.agents[":agentId"].$get({ param: { agentId } });

      if (!res.ok) return { ...json({ error: `Agent ${agentId} not found` }), isError: true };

      return json(await res.json());
    }
  );
}

export function registerGetAgentFeedback(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  server.registerTool(
    "get_agent_feedback",
    {
      title: "Get agent feedback",
      description:
        "Get onchain feedback for one agent, newest first. Each entry carries a numeric value, " +
        "the client address that gave it, and when available a reasoning and a proof of payment. " +
        "Revoked feedback is excluded. Values are not guaranteed to be on a 0-100 scale; " +
        "the agent's 0-100 `score` from get_agent aggregates only the 0-100 entries. " +
        "Empty `data` means the agent has no feedback yet. " +
        "Read `next` from the response and pass it back as `offset` to get the following page. On the last page `next` is null.",
      inputSchema: {
        agentId: agentIdSchema.describe(
          "Agent id, chain and onchain id joined by an underscore, for example 0g_12"
        ),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Results to skip. Pass the `next` value from the previous response"),
        limit: z.number().int().min(1).max(50).default(20).describe("Results per page, 1 to 50"),
      },
    },
    async ({ agentId, offset, limit }) => {
      const res = await api.agents[":agentId"].feedbacks.$get({
        param: { agentId },
        query: { offset: String(offset), limit: String(limit) },
      });

      if (!res.ok) return { ...json({ error: `Agent ${agentId} not found` }), isError: true };

      return json(await res.json());
    }
  );
}

export function registerAgentTools(server: McpServer, api: ReturnType<typeof hc<AppType>>) {
  registerSearchAgents(server, api);
  registerSearchServices(server, api);
  registerGetAgent(server, api);
  registerGetAgentFeedback(server, api);
}
