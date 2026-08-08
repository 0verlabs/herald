import type { AgentCategory } from "../types/agent";
import { agentCategorySchema } from "../types/agent";

export const AGENT_CATEGORIES = agentCategorySchema.options;

export const AGENT_CATEGORY_LABELS: Record<AgentCategory, string> = {
  finance: "Finance",
  productivity: "Productivity",
  "developer-tools": "Developer tools",
  writing: "Writing",
  research: "Research",
  others: "Others",
};

/** Filter value that also accepts every agent ("all"). */
export type AgentCategoryFilter = AgentCategory | "all";

export const AGENT_CATEGORY_FILTERS: AgentCategoryFilter[] = ["all", ...AGENT_CATEGORIES];

export const AGENT_CATEGORY_FILTER_LABELS: Record<AgentCategoryFilter, string> = {
  all: "All",
  ...AGENT_CATEGORY_LABELS,
};

export interface AgentSortOption {
  id: AgentSortId;
  label: string;
}

export type AgentSortId = "popular" | "top-rated" | "cheapest";

export const AGENT_SORT_OPTIONS: AgentSortOption[] = [
  { id: "popular", label: "Most called" },
  { id: "top-rated", label: "Highest rated" },
  { id: "cheapest", label: "Lowest price" },
];

/** Label lookup for a sort id, e.g. for the closed select trigger. */
export const AGENT_SORT_LABELS = Object.fromEntries(
  AGENT_SORT_OPTIONS.map(({ id, label }) => [id, label])
) as Record<AgentSortId, string>;

export const DEFAULT_AGENT_CATEGORY: AgentCategoryFilter = "all";
export const DEFAULT_AGENT_SORT: AgentSortId = "popular";

/** How many agents a single cursor page returns. */
export const AGENTS_PAGE_SIZE = 15;

/** How many services a single page shows on the agent detail view. */
export const SERVICES_PAGE_SIZE = 9;
