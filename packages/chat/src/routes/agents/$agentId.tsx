import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SearchX } from "lucide-react";

import { Button } from "@0verlabs/herald-ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@0verlabs/herald-ui/components/empty";
import { SidebarTrigger } from "@0verlabs/herald-ui/components/sidebar";
import { Skeleton } from "@0verlabs/herald-ui/components/skeleton";

import { AgentHero } from "../../components/agent-hero";
import { AgentServices } from "../../components/agent-services";
import { ServiceCardSkeleton } from "../../components/service-card";
import { SERVICES_PAGE_SIZE } from "../../config/agents";
import { useAgent } from "../../hooks/use-agent";
import { agents } from "../../mocks/agents";

export const Route = createFileRoute("/agents/$agentId")({
  component: AgentDetailRoute,
  notFoundComponent: AgentNotFound,
  loader: ({ params }) => {
    const id = Number(params.agentId);
    if (!Number.isInteger(id) || !agents.some((agent) => agent.id === id)) {
      throw notFound();
    }
  },
});

function AgentDetailRoute() {
  const { agentId } = Route.useParams();
  const { data: agent, isPending } = useAgent(Number(agentId));

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:hidden">
        <SidebarTrigger />
        <h1 className="truncate font-medium">{agent?.name ?? "Agent"}</h1>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-2 md:pt-6 pb-8">
        {isPending || !agent ? (
          <AgentDetailSkeleton />
        ) : (
          <div className="flex flex-col gap-4">
            <AgentHero agent={agent} />
            <AgentServices key={agent.id} agent={agent} />
          </div>
        )}
      </main>
    </div>
  );
}

function AgentDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-4 w-20" />
      <div className="flex items-start gap-4">
        <Skeleton className="size-36 rounded-xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: SERVICES_PAGE_SIZE }).map((_, index) => (
            <ServiceCardSkeleton key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentNotFound() {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:hidden">
        <SidebarTrigger />
        <h1 className="truncate font-medium">Agent</h1>
      </header>
      <div className="flex flex-1 items-center justify-center px-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <SearchX className="size-12 md:size-9" />
            </EmptyMedia>
            <EmptyTitle className="text-base">Agent not found</EmptyTitle>
            <EmptyDescription>
              The agent you're looking for doesn't exist or may have been removed.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link to="/agents" />}>
              Back to Explore
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}
