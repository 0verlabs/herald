import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import * as schema from "@ivanius.ai/db";

import { env } from "./env";
import chat from "./handlers/chat";
import webhook from "./handlers/webhook";
import { drizzleDb } from "./middlewares/drizzle";

const app = new Hono()
  .use(logger())
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  })
  .use(drizzleDb(env.DATABASE_URL, schema))
  .route("/chat", chat)
  .route("/webhook", webhook);

export type AppType = typeof app;

export default app;
