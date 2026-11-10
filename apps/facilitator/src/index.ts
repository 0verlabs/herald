import { environmentFromCloudflareEnv } from "@herald/core";
import { Hono } from "hono";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", async (c) => {
  await c.env.DB.prepare("select 1").first();
  return c.json({
    status: "ok",
    service: "facilitator",
    // Inlined at deploy time with `wrangler deploy --define`; unset locally.
    environment: environmentFromCloudflareEnv(process.env.CLOUDFLARE_ENV),
  });
});

export default app;
