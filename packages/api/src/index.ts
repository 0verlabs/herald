import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import chat from "./handlers/chat";

const app = new Hono<{ Bindings: Env }>()
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  })
  .route("/chat", chat);

export type AppType = typeof app;

export default app;
