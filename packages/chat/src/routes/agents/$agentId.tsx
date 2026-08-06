import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents/$agentId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/agents/$agentId"!</div>;
}
