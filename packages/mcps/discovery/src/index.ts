import type { AppType } from "@hrld/api/rpc";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { hc } from "hono/client";
import { logger } from "hono/logger";

import { env } from "./env";
import { registerAgentTools } from "./tools/agents";

const mcpServer = new McpServer({ name: "herald-discovery", version: "0.0.0" });
const apiClient = hc<AppType>(env.BASE_API_URL);

registerAgentTools(mcpServer, apiClient);

const transport = new StreamableHTTPTransport();

const app = new Hono().use(logger()).all("/", async (c) => {
  if (!mcpServer.isConnected()) await mcpServer.connect(transport);

  return transport.handleRequest(c);
});

export default app;
