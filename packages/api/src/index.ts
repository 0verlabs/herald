import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import * as schema from "@ivanius.ai/db";

import chat from "./handlers/chat";
import wallets from "./handlers/wallet";
import webhook from "./handlers/webhook";
import { drizzleDb } from "./middlewares/drizzle";

const app = new Hono<{ Bindings: Env }>()
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  })
  .use(drizzleDb(schema))
  .route("/chat", chat)
  .route("/wallets", wallets)
  .route("/webhook", webhook);

export type AppType = typeof app;

export default app;
