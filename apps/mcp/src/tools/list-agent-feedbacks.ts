import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listAgentFeedbacksOutputSchema,
  listAgentFeedbacksParamsSchema,
  listAgentFeedbacksQuerySchema,
} from "@hrld/api/rpc";
import { z } from "zod";

import { ApiClient } from "../lib/api";
import { errorResult, jsonResult, toolOutputSchema } from "../lib/mcp";

const listAgentFeedbacksInputSchema = z.object({
  ...listAgentFeedbacksParamsSchema.shape,
  ...listAgentFeedbacksQuerySchema.shape,
});

export const registerListAgentFeedbacksTool = (client: ApiClient) => (server: McpServer) => {
  server.registerTool(
    "list_agent_feedbacks",
    {
      title: "List agent feedbacks",
      description:
        "List feedback left for an agent. Each entry has the client address, score, tags, feedback URI, and creation details. Paginate with limit and skip. Errors if the agent does not exist.",
      inputSchema: listAgentFeedbacksInputSchema,
      outputSchema: toolOutputSchema(listAgentFeedbacksOutputSchema),
    },
    async (input) => {
      const response = await client.v1.agents[":agentId"].feedbacks.$get({
        param: { agentId: input.agentId.toString() },
        query: {
          limit: String(input.limit),
          skip: String(input.skip),
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return errorResult(text);
      }

      const json = await response.json();
      return jsonResult(json);
    },
  );
};
