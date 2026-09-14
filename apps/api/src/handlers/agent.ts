import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { problemDetailsResponse } from "hono-problem-details/openapi";
import { problemDetails } from "hono-problem-details";

import { AgentSummaryFragment } from "../lib/subgraphs/__generated/erc-8004";
import { Env } from "../env";
import { agentEntityId } from "../utils/agent";
import { parseTimestamp } from "../utils/timestamp";
import { CHAIN_IDS } from "../config/chain";
import { REGISTRIES } from "../config/agent-registry";
import {
  getAgentOutputSchema,
  getAgentParamsSchema,
  listAgentFeedbacksOutputSchema,
  listAgentFeedbacksParamsSchema,
  listAgentFeedbacksQuerySchema,
  listAgentServicesOutputSchema,
  listAgentServicesParamsSchema,
  searchAgentsOutputSchema,
  searchAgentsQuerySchema,
} from "../schemas/agents";

const toAgentSummary = (agent: AgentSummaryFragment) => ({
  id: agent.id,
  name: agent.profile?.name ?? "",
  description: agent.profile?.description ?? "",
  image: agent.profile?.image ?? null,
  metadata: Object.fromEntries(agent.metadata.map(({ key, value }) => [key, value])),
  feedbackCount: Number(agent.feedbackCount),
  owner: agent.owner?.address ?? "0x",
  createdAt: parseTimestamp(agent.createdAt),
  createdAtTransaction: agent.createdAtTransaction,
});

export const searchAgentsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: searchAgentsQuerySchema,
  },
  responses: {
    200: {
      description: "Agents found",
      content: {
        "application/json": {
          schema: searchAgentsOutputSchema,
        },
      },
    },
  },
});

export const getAgentRoute = createRoute({
  method: "get",
  path: "/{agentId}",
  request: {
    params: getAgentParamsSchema,
  },
  responses: {
    200: {
      description: "Agent found",
      content: {
        "application/json": {
          schema: getAgentOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

export const listAgentServicesRoute = createRoute({
  method: "get",
  path: "/{agentId}/services",
  request: {
    params: listAgentServicesParamsSchema,
  },
  responses: {
    200: {
      description: "Agent services found",
      content: {
        "application/json": {
          schema: listAgentServicesOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

export const listAgentFeedbacksRoute = createRoute({
  method: "get",
  path: "/{agentId}/feedbacks",
  request: {
    params: listAgentFeedbacksParamsSchema,
    query: listAgentFeedbacksQuerySchema,
  },
  responses: {
    200: {
      description: "Agent feedback found",
      content: {
        "application/json": {
          schema: listAgentFeedbacksOutputSchema,
        },
      },
    },
    404: problemDetailsResponse(404),
  },
});

const notFound = (agentId: string) =>
  problemDetails({
    status: 404,
    title: "Not found",
    detail: `Agent with id ${agentId} not found`,
    type: "Agent",
  });

const entityId = (agentId: string) =>
  agentEntityId(CHAIN_IDS.zeroG, REGISTRIES[CHAIN_IDS.zeroG].identityRegistry, agentId);

const attributeValue = (attribute: { value: string; valueType: string }): unknown => {
  if (attribute.valueType === "NUMBER") return Number(attribute.value);
  if (attribute.valueType === "BOOLEAN") return attribute.value === "true";
  if (attribute.valueType === "JSON") {
    try {
      return JSON.parse(attribute.value);
    } catch {
      return attribute.value;
    }
  }
  return attribute.value;
};

export const agentHandlers = new OpenAPIHono<Env>()
  .openapi(searchAgentsRoute, async (c) => {
    const query = c.req.valid("query");
    const owner = query.owner?.toLowerCase();

    // agentProfileSearch requires a non-empty fulltext query, so fall back to
    // listing agents with a registration when q is absent.
    const agents = query.q
      ? (
          await c.var.erc8004.SearchAgentProfiles({
            text: query.q,
            first: query.limit,
            skip: query.skip,
            where: owner ? { agent_: { owner } } : undefined,
          })
        ).agentProfileSearch.map((profile) => profile.agent)
      : (
          await c.var.erc8004.ListAgents({
            first: query.limit,
            skip: query.skip,
            where: {
              registration_not: null,
              ...(owner ? { owner } : {}),
            },
          })
        ).agents;

    const result = searchAgentsOutputSchema.safeParse(agents.map(toAgentSummary));
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(getAgentRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();

    const { agents } = await c.var.erc8004.GetAgent({ id: entityId(agentId) });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const result = getAgentOutputSchema.safeParse(toAgentSummary(agent));
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(listAgentServicesRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();

    const { agents } = await c.var.erc8004.GetAgentServices({ id: entityId(agentId) });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const registration = agent.registration;
    const services = registration && "services" in registration ? registration.services : [];

    const result = listAgentServicesOutputSchema.safeParse(
      services.map((service) => ({
        id: service.id,
        name: service.name,
        kind: service.kind,
        endpoint: service.endpoint,
        version: service.version ?? null,
        features: service.features.map(({ kind, value }) => ({ kind, value })),
        attributes: Object.fromEntries(
          service.attributes.map((attribute) => [attribute.key, attributeValue(attribute)]),
        ),
      })),
    );
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  })
  .openapi(listAgentFeedbacksRoute, async (c) => {
    const agentId = c.req.valid("param").agentId.toString();
    const query = c.req.valid("query");

    const { agents } = await c.var.erc8004.GetAgentFeedbacks({
      id: entityId(agentId),
      first: query.limit,
      skip: query.skip,
    });
    const [agent] = agents;

    if (!agent) throw notFound(agentId);

    const result = listAgentFeedbacksOutputSchema.safeParse(
      agent.feedback.map((feedback) => ({
        id: feedback.id,
        client: feedback.client.address,
        score: Number(feedback.value) / 10 ** feedback.valueDecimals,
        tag1: feedback.tag1,
        tag2: feedback.tag2,
        uri: feedback.feedbackURI,
        createdAt: parseTimestamp(feedback.createdAt),
        createdAtTransaction: feedback.createdAtTransaction,
      })),
    );
    if (!result.success) throw new Error(result.error.message);

    return c.json(result.data);
  });
