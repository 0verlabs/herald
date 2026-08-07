import { Link } from "@tanstack/react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@ivanius.ai/ui/components/avatar";
import { Card, CardDescription, CardFooter, CardTitle } from "@ivanius.ai/ui/components/card";
import { Separator } from "@ivanius.ai/ui/components/separator";
import { Skeleton } from "@ivanius.ai/ui/components/skeleton";
import { cn } from "@ivanius.ai/ui/lib/utils";

import type { Agent } from "../types/agent";
import UsdcLogo from "../assets/logos/usdc.svg?react";
import { formatCompactNumber, formatPrice } from "../lib/format";

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Green above 80, amber above 40, red below — plain number, no "/100". */
function scoreClassName(score: number) {
  if (score > 80) return "text-green-600 dark:text-green-400";
  if (score > 40) return "text-amber-500 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function AgentScore({ score }: { score: number }) {
  if (score === 0) return <span>No ratings</span>;
  return <span className={cn("font-medium", scoreClassName(score))}>{score}</span>;
}

interface AgentCardProps {
  agent: Agent;
}

/** A single agent in the catalog grid. Links through to the agent detail page. */
export function AgentCard({ agent }: AgentCardProps) {
  return (
    <Link
      to="/agents/$agentId"
      params={{ agentId: agent.id.toString() }}
      className="group flex w-full focus-visible:outline-none"
    >
      <Card className="h-full w-full transition-shadow group-hover:ring-2 group-hover:ring-ring/40 group-focus-visible:ring-3 group-focus-visible:ring-ring/50">
        <div className="flex flex-col gap-3 px-(--card-spacing)">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 rounded after:rounded">
              <AvatarImage src={agent.image} alt={agent.name} className="rounded" />
              <AvatarFallback className="rounded">{initialsOf(agent.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate">{agent.name}</CardTitle>
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <AgentScore score={agent.score} />
                {agent.calls > 0 && (
                  <>
                    <Separator orientation="vertical" className="h-3 bg-foreground/40" />
                    <span className="truncate">{formatCompactNumber(agent.calls)} calls</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <CardDescription className="line-clamp-2">{agent.description}</CardDescription>
        </div>
        <CardFooter className="mt-auto justify-end">
          {agent.startsFrom ? (
            <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">
              <UsdcLogo className="size-5" />
              {formatPrice(agent.startsFrom)} USDC
            </span>
          ) : (
            <span className="items-center font-mono text-muted-foreground inline-flex gap-1.5">
              Negotiable
            </span>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

/** Loading placeholder matching the `AgentCard` layout — card shell with skeleton content. */
export function AgentCardSkeleton() {
  return (
    <Card aria-hidden className="h-full w-full">
      <div className="flex flex-col gap-3 px-(--card-spacing)">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
      <CardFooter className="mt-auto justify-end">
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardFooter>
    </Card>
  );
}
