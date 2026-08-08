import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Copy, SearchX } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@ivanius.ai/ui/components/avatar";
import { Button } from "@ivanius.ai/ui/components/button";
import { Card, CardDescription, CardFooter, CardTitle } from "@ivanius.ai/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ivanius.ai/ui/components/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ivanius.ai/ui/components/empty";
import { Separator } from "@ivanius.ai/ui/components/separator";
import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";
import { Skeleton } from "@ivanius.ai/ui/components/skeleton";
import { toast } from "@ivanius.ai/ui/components/toast";
import { cn } from "@ivanius.ai/ui/lib/utils";

import type { Agent, AgentService } from "../../types/agent";
import UsdcLogo from "../../assets/logos/usdc.svg?react";
import { SERVICES_PAGE_SIZE } from "../../config/agents";
import { useAgent } from "../../hooks/use-agent";
import { useAgentServices } from "../../hooks/use-agent-services";
import { copyText } from "../../lib/clipboard";
import { formatCompactNumber, formatPrice } from "../../lib/format";
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

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Green above 80, amber above 40, red below — same scale as the agent cards. */
function scoreClassName(score: number) {
  if (score > 80) return "text-green-600 dark:text-green-400";
  if (score > 40) return "text-amber-500 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

interface PromptDetails {
  service: string;
  text: string;
}

/** One shared template for every service; only the service details change. */
function buildServicePrompt(input: {
  agentId: Agent["id"];
  agentName: string;
  title: string;
  summary: string;
}): string {
  return [
    `Call the "${input.agentName}" agent (#${input.agentId}) and use its "${input.title}" service.`,
    "",
    `What it does: ${input.summary}`,
    "Each call is standalone — no account, API key or subscription is required.",
  ].join("\n");
}

function AgentDetailRoute() {
  const { agentId } = Route.useParams();
  const { data: agent, isPending } = useAgent(Number(agentId));
  const [prompt, setPrompt] = useState<PromptDetails | null>(null);

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
            <ServicesSection key={agent.id} agent={agent} onShowPrompt={setPrompt} />
          </div>
        )}
      </main>
      <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

function AgentHero({ agent }: { agent: Agent }) {
  return (
    <section className="flex flex-col gap-5">
      <Link
        to="/agents"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft />
        Explore
      </Link>
      <div className="flex items-start gap-4">
        <Avatar className="size-36 rounded-xl after:rounded-xl">
          <AvatarImage src={agent.image} alt={agent.name} className="rounded-xl" />
          <AvatarFallback className="rounded-xl text-lg">{initialsOf(agent.name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 self-stretch flex-col gap-1.5 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-medium md:text-3xl">{agent.name}</h1>
          </div>
          <p className="text-muted-foreground line-clamp-3 max-w-2xl">{agent.description}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 font-mono text-xs text-muted-foreground">
            {agent.score === 0 ? (
              <span>No ratings</span>
            ) : (
              <span className="font-medium">
                <span>Score: </span>
                <span className={scoreClassName(agent.score)}>{agent.score}</span>
              </span>
            )}
            {agent.calls > 0 && (
              <>
                <Separator orientation="vertical" className="h-3 bg-foreground/40" />
                <span>{formatCompactNumber(agent.calls)} calls</span>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ServicesSection({
  agent,
  onShowPrompt,
}: {
  agent: Agent;
  onShowPrompt: (prompt: PromptDetails) => void;
}) {
  const [page, setPage] = useState(1);
  const { data, isPending, isFetching } = useAgentServices(agent.id, page);

  const services = data?.services ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / SERVICES_PAGE_SIZE));
  const start = (page - 1) * SERVICES_PAGE_SIZE;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-lg">Services</p>
        {!isPending && data && (
          <span className="font-mono text-xs text-muted-foreground">{total} services</span>
        )}
      </div>
      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: SERVICES_PAGE_SIZE }).map((_, index) => (
            <ServiceCardSkeleton key={index} />
          ))}
        </div>
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
          <div
            className={cn(
              "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
              "transition-opacity",
              isFetching && "opacity-60"
            )}
          >
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                agent={agent}
                service={service}
                onShowPrompt={onShowPrompt}
              />
            ))}
          </div>
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
    </section>
  );
}

function ServiceCard({
  agent,
  service,
  onShowPrompt,
}: {
  agent: Agent;
  service: AgentService;
  onShowPrompt: (prompt: PromptDetails) => void;
}) {
  return (
    <Card className="h-full w-full">
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <CardTitle className="truncate">{service.title}</CardTitle>
        <CardDescription className="line-clamp-2">{service.summary}</CardDescription>
      </div>
      <CardFooter className="mt-auto justify-end gap-2">
        {service.fee === null ? (
          <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">
            Free
          </span>
        ) : (
          <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">
            <UsdcLogo className="size-5" />
            {formatPrice(service.fee)} USDC
          </span>
        )}
        <Button
          size="sm"
          aria-label={`Show prompt for the ${service.title} service`}
          onClick={() =>
            onShowPrompt({
              service: service.title,
              text: buildServicePrompt({
                agentId: agent.id,
                agentName: agent.name,
                title: service.title,
                summary: service.summary,
              }),
            })
          }
        >
          Run
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Loading placeholder matching the `ServiceCard` layout — card shell with skeleton content. */
function ServiceCardSkeleton() {
  return (
    <Card aria-hidden className="h-full w-full">
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <Skeleton className="h-5 w-2/3" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
      <CardFooter className="mt-auto justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-14 rounded-lg" />
      </CardFooter>
    </Card>
  );
}

function PromptDialog({ prompt, onClose }: { prompt: PromptDetails | null; onClose: () => void }) {
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{prompt ? `Use "${prompt.service}"` : ""}</DialogTitle>
          <DialogDescription>
            Paste this prompt into your AI assistant to use this service.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 overflow-y-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
          {prompt?.text}
        </pre>
        <DialogFooter showCloseButton>
          <Button
            onClick={() => {
              if (!prompt) return;
              copyText(prompt.text);
              toast.add({ title: "Prompt copied", type: "success" });
            }}
          >
            <Copy />
            Copy prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
