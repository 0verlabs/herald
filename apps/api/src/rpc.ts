// Type-only import keeps the app (route registration, problem-details
// middleware) out of consumer bundles like apps/mcp.
import type app from ".";

export {
  getAgentOutputSchema,
  getAgentParamsSchema,
  listAgentFeedbacksOutputSchema,
  listAgentFeedbacksParamsSchema,
  listAgentFeedbacksQuerySchema,
  listAgentServicesOutputSchema,
  listAgentServicesParamsSchema,
  searchAgentsOutputSchema,
  searchAgentsQuerySchema,
} from "./schemas/agents";
export { listJobsOutputSchema, listJobsQuerySchema } from "./schemas/jobs";

export type ApiClientType = typeof app;
