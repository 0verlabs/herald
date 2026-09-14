import { GraphQLClient } from "graphql-request";
import { OpenAPIHono as Hono } from "@hono/zod-openapi";
import { problemDetailsHandler } from "hono-problem-details";
import { logger } from "hono/logger";

import { getSdk as getErc8004Sdk } from "./lib/subgraphs/__generated/erc-8004";
import { getSdk as getErc8183Sdk } from "./lib/subgraphs/__generated/erc-8183";

import { agentHandlers } from "./handlers/agent";
import { jobHandlers } from "./handlers/jobs";
import { Env } from "./env";

const app = new Hono<Env>()
  .use(logger())
  .onError(
    problemDetailsHandler({
      autoInstance: true,
    }),
  )
  .basePath("/v1")
  .use(async (c, next) => {
    const erc8004Client = new GraphQLClient(c.env.ERC_8004_SUBGRAPH_URL, {
      fetch,
      headers: {
        Authorization: `Bearer ${c.env.ERC_8004_SUBGRAPH_API_KEY}`,
      },
      signal: c.req.raw.signal,
    });
    const erc8183Client = new GraphQLClient(c.env.ERC_8183_SUBGRAPH_URL, {
      fetch,
      headers: {
        Authorization: `Bearer ${c.env.ERC_8183_SUBGRAPH_API_KEY}`,
      },
      signal: c.req.raw.signal,
    });

    const erc8004 = getErc8004Sdk(erc8004Client);
    c.set("erc8004", erc8004);

    const erc8183 = getErc8183Sdk(erc8183Client);
    c.set("erc8183", erc8183);

    return next();
  })
  .route("/agents", agentHandlers)
  .route("/jobs", jobHandlers);

export default app;
