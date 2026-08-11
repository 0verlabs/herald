import type { ReactNode } from "react";
import { Button } from "@hrld/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@hrld/ui/components/empty";
import { cn } from "@hrld/ui/lib/utils";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { useState } from "react";

import type { Agent, AgentService } from "../types/agent";
import type { ServicePrompt } from "./service-prompt-dialog";
import { SERVICES_PAGE_SIZE } from "../config/agents";
import { useAgentServices } from "../hooks/use-agent-services";
import { ServiceCard, ServiceCardSkeleton } from "./service-card";
import { buildServicePrompt, ServicePromptDialog } from "./service-prompt-dialog";

/** Paginated services grid for one agent, including its "use this service" prompt dialog. */
export function AgentServices({ agent }: { agent: Agent }) {
  const [page, setPage] = useState(1);
  const [prompt, setPrompt] = useState<ServicePrompt | null>(null);
  const { data, isPending, isFetching } = useAgentServices(agent.id, page);

  const services = data?.services ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / SERVICES_PAGE_SIZE));
  const start = (page - 1) * SERVICES_PAGE_SIZE;

  function showPrompt(service: AgentService) {
    setPrompt({
      service: service.name,
      text: buildServicePrompt({
        agentId: agent.id,
        agentName: agent.name,
        serviceName: service.name,
        serviceDescription: service.description,
      }),
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-lg">Services</p>
        {!isPending && data && (
          <span className="font-mono text-xs text-muted-foreground">{total} services</span>
        )}
      </div>
      {isPending ? (
        <ServicesGrid>
          {Array.from({ length: SERVICES_PAGE_SIZE }).map((_, index) => (
            <ServiceCardSkeleton key={index} />
          ))}
        </ServicesGrid>
      ) : total === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <SearchX className="size-12 md:size-9" />
            </EmptyMedia>
            <EmptyTitle className="text-base">No services</EmptyTitle>
            <EmptyDescription>This agent has no services to show right now.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ServicesGrid isFetching={isFetching}>
            {services.map((service) => (
              <ServiceCard key={service.id} service={service} onShowPrompt={showPrompt} />
            ))}
          </ServicesGrid>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                aria-label="Previous services page"
                onClick={() => setPage((current) => current - 1)}
              >
                <ChevronLeft />
                Prev
              </Button>
              <p className="font-mono text-xs text-muted-foreground">
                {start + 1}–{Math.min(start + SERVICES_PAGE_SIZE, total)} of {total}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                aria-label="Next services page"
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
      <ServicePromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </section>
  );
}

function ServicesGrid({
  isFetching = false,
  children,
}: {
  isFetching?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
        "transition-opacity",
        isFetching && "opacity-60"
      )}
    >
      {children}
    </div>
  );
}
