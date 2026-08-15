import type { Tag } from "@hrld/core";
import { tags } from "@hrld/core";

export const AGENT_TAGS = tags;

export const AGENT_TAG_LABELS: Record<Tag, string> = {
  finance: "Finance",
  productivity: "Productivity",
  "developer-tools": "Developer tools",
  writing: "Writing",
  research: "Research",
};

/**
 * Filter values: every agent ("all"), a curated tag, or "others" — agents
 * whose tags all fall outside the curated list.
 */
export type AgentTagFilter = Tag | "others" | "all";

export const AGENT_TAG_FILTERS: AgentTagFilter[] = ["all", ...AGENT_TAGS, "others"];

export const AGENT_TAG_FILTER_LABELS: Record<AgentTagFilter, string> = {
  all: "All",
  ...AGENT_TAG_LABELS,
  others: "Others",
};

export interface AgentSortOption {
  id: AgentSortId;
  label: string;
}

export type AgentSortId = "top-rated" | "cheapest";

export const AGENT_SORT_OPTIONS: AgentSortOption[] = [
  { id: "top-rated", label: "Highest rated" },
  { id: "cheapest", label: "Lowest price" },
];

/** Label lookup for a sort id, e.g. for the closed select trigger. */
export const AGENT_SORT_LABELS = Object.fromEntries(
  AGENT_SORT_OPTIONS.map(({ id, label }) => [id, label])
) as Record<AgentSortId, string>;

export const DEFAULT_AGENT_TAG: AgentTagFilter = "all";
export const DEFAULT_AGENT_SORT: AgentSortId = "top-rated";

/** How many agents a single cursor page returns. */
export const AGENTS_PAGE_SIZE = 15;

/** How many services a single page shows on the agent detail view. */
export const SERVICES_PAGE_SIZE = 9;
