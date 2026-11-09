import { EnvironmentSchema } from "@herald/core";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        await env.DB.prepare("select 1").first();
        return Response.json({
          status: "ok",
          service: "web",
          environment: EnvironmentSchema.parse(env.HERALD_ENV),
        });
      },
    },
  },
});
