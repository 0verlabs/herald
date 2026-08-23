import * as appSchema from "@hrld/db";
import * as indexerSchema from "@hrld/indexer/schema";
import { setDatabaseSchema } from "@ponder/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { env } from "./env";
import { agents } from "./handlers/agents";
import { webhook } from "./handlers/webhook";
import { drizzleDb } from "./middlewares/drizzle";

setDatabaseSchema(indexerSchema, env.INDEXER_DATABASE_SCHEMA);

const app = new Hono()
  .use(logger())
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  })
  .use(drizzleDb(env.DATABASE_URL, { ...appSchema, ...indexerSchema }))
  .route("/agents", agents)
  .route("/webhook", webhook);

export default app;
