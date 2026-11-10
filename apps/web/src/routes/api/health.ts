import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { readEnvironment } from "@/server/environment";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        await env.DB.prepare("select 1").first();
        return Response.json({ status: "ok", service: "web", environment: readEnvironment() });
      },
    },
  },
});
