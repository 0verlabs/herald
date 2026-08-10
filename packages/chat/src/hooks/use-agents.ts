import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import type { AgentCategoryFilter, AgentSortId } from "../config/agents";
import type { Agent } from "../types/agent";
import { agents } from "../mocks/agents";

export interface AgentsFilter {
  query: string;
  category: AgentCategoryFilter;
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
        const matchesCategory = filter.category === "all" || agent.category === filter.category;
        const matchesQuery =
          needle === "" ||
          agent.name.toLowerCase().includes(needle) ||
          agent.description.toLowerCase().includes(needle);
        return matchesCategory && matchesQuery;
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
