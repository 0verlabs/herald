import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { registerAgentTools } from "./tools/agents";

const mcpServer = new McpServer({ name: "herald-discovery", version: "0.0.0" });

registerAgentTools(mcpServer);

const transport = new StreamableHTTPTransport();

const app = new Hono().use(logger()).all("/", async (c) => {
  if (!mcpServer.isConnected()) await mcpServer.connect(transport);

  return transport.handleRequest(c);
});

export default app;
