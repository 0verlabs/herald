import type { ReactNode } from "react";
import { useIntersectionObserver } from "@uidotdev/usehooks";
import { SearchX } from "lucide-react";
import { useEffect } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ivanius.ai/ui/components/empty";
import { cn } from "@ivanius.ai/ui/lib/utils";

import type { Agent } from "../types/agent";
import { AGENTS_PAGE_SIZE } from "../config/agents";
import { AgentCard, AgentCardSkeleton } from "./agent-card";

const GRID_CLASS = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

interface AgentListProps {
  agents?: Agent[];
  isPending: boolean;
  /** True while a filter change refetches with previous data still shown. */
  isFetching: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Empty-state override, rendered when the server returns no agents. */
  emptyState?: ReactNode;
}

/** Responsive grid of `AgentCard`s that loads the next cursor page on scroll. */
export function AgentList({
  agents,
  isPending,
  isFetching,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  emptyState,
}: AgentListProps) {
  const [sentinelRef, entry] = useIntersectionObserver({
    threshold: 0,
    rootMargin: "-6px",
  });

  useEffect(() => {
    if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
      onLoadMore();
    }
  }, [entry]);

  if (isPending) return <AgentListSkeleton />;

  if (!agents || agents.length === 0) {
    return (
      emptyState ?? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No agents found</EmptyTitle>
            <EmptyDescription>Try a different search term or category.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul
        className={cn(
          GRID_CLASS,
          "transition-opacity",
          isFetching && !isFetchingNextPage && "opacity-60"
        )}
      >
        {agents.map((agent) => (
          <li key={agent.id} className="flex min-w-0">
            <AgentCard agent={agent} />
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <div ref={sentinelRef} className="flex flex-col gap-6">
          {isFetchingNextPage && <AgentListSkeleton />}
        </div>
      )}
    </div>
  );
}

function AgentListSkeleton() {
  return (
    <ul aria-hidden className={GRID_CLASS}>
      {Array.from({ length: AGENTS_PAGE_SIZE }, (_, index) => (
        <li key={index} className="flex min-w-0">
          <AgentCardSkeleton />
        </li>
      ))}
    </ul>
    // <div className="flex flex-col gap-6">
    // </div>
  );
}
