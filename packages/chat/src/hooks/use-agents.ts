import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import type { AgentSortId, AgentTagFilter } from "../config/agents";
import type { Agent } from "../types/agent";
import { AGENT_TAGS } from "../config/agents";
import { agents } from "../mocks/agents";

export interface AgentsFilter {
  query: string;
  tag: AgentTagFilter;
  sort: AgentSortId;
  pageSize: number;
}

export interface AgentsPage {
  agents: Agent[];
  nextCursor: string | null;
}

const comparators: Record<AgentSortId, (a: Agent, b: Agent) => number> = {
  "top-rated": (a, b) => b.score - a.score,
  cheapest: (a, b) => (a.startsFrom ?? 0) - (b.startsFrom ?? 1),
};

/** Mocked server call: filters, sorts, and slices one cursor page. */
async function fetchAgents(filter: AgentsFilter, cursor: string): Promise<AgentsPage> {
  return await new Promise((resolve) => {
    setTimeout(() => {
      const needle = filter.query.trim().toLowerCase();

      const results = agents.filter((agent) => {
        // "others" matches agents whose tags all fall outside the curated list.
        const matchesTag =
          filter.tag === "all" ||
          (filter.tag === "others"
            ? !agent.tags.some((tag) => (AGENT_TAGS as readonly string[]).includes(tag))
            : agent.tags.includes(filter.tag));
        const matchesQuery =
          needle === "" ||
          agent.name.toLowerCase().includes(needle) ||
          agent.description.toLowerCase().includes(needle);
        return matchesTag && matchesQuery;
      });

      const sorted = [...results].sort(comparators[filter.sort]);
      const offset = Number.parseInt(cursor, 10) || 0;
      const page = sorted.slice(offset, offset + filter.pageSize);
      const nextOffset = offset + page.length;

      resolve({
        agents: page,
        nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
      });
    }, 400);
  });
}

/** Agent catalog for `/agents` as an infinite, cursor-paginated feed. */
export function useAgents(filter: AgentsFilter) {
  return useInfiniteQuery({
    queryKey: ["agents", filter],
    queryFn: ({ pageParam }) => fetchAgents(filter, pageParam),
    initialPageParam: "0",
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
