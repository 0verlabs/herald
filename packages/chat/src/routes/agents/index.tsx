import { createFileRoute } from "@tanstack/react-router";
import { useDebounce } from "@uidotdev/usehooks";
import { Compass, Search, SearchX } from "lucide-react";
import { useState } from "react";

import { Button } from "@ivanius.ai/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@ivanius.ai/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@ivanius.ai/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ivanius.ai/ui/components/select";
import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import type { AgentCategoryFilter, AgentSortId } from "../../config/agents";
import { AgentList } from "../../components/agent-list";
import { CategorySelector } from "../../components/category-selector";
import { FeaturedAgentsCarousel } from "../../components/featured-agents-carousel";
import {
  AGENT_SORT_LABELS,
  AGENT_SORT_OPTIONS,
  AGENTS_PAGE_SIZE,
  DEFAULT_AGENT_CATEGORY,
  DEFAULT_AGENT_SORT,
} from "../../config/agents";
import { useAgents } from "../../hooks/use-agents";

export const Route = createFileRoute("/agents/")({
  component: AgentsRoute,
});

function AgentsRoute() {
  const [query, setQuery] = useState("");
  const throttledQuery = useDebounce(query, 300);
  const [category, setCategory] = useState<AgentCategoryFilter>(DEFAULT_AGENT_CATEGORY);
  const [sort, setSort] = useState<AgentSortId>(DEFAULT_AGENT_SORT);

  const {
    data,
    isPending,
    isFetching,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useAgents({ query: throttledQuery, category, sort, pageSize: AGENTS_PAGE_SIZE });

  const agents = data?.pages.flatMap((page) => page.agents);

  const hasActiveFilters = category !== "all" || query.trim() !== "";

  function clearFilters() {
    setQuery("");
    setCategory(DEFAULT_AGENT_CATEGORY);
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="z-1 flex md:hidden h-14 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger />
        <h1 className="truncate font-medium">Explore</h1>
      </header>
      <div className="z-0 -mt-14 md:mt-0 bg-primary/8 mask-b-from-70%">
        <FeaturedAgentsCarousel />
      </div>
      <main className="flex flex-col w-full">
        <div className="sticky top-0 z-10 flex w-full py-4 bg-background mask-b-from-90%">
          <div className="px-4 mx-auto flex w-full max-w-6xl flex-col gap-4">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <CategorySelector value={category} onValueChange={setCategory} />
              <InputGroup className="col-span-2 row-start-2 md:col-span-1 md:col-start-1">
                <InputGroupAddon align="inline-start">
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  placeholder="Search agents"
                  aria-label="Search agents"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
              <Select
                items={AGENT_SORT_LABELS}
                value={sort}
                onValueChange={(next) => {
                  if (next) setSort(next);
                }}
              >
                <SelectTrigger
                  aria-label="Sort agents"
                  className="col-start-2 row-start-1 md:row-start-2"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {AGENT_SORT_OPTIONS.map(({ id, label }) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="px-4 mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
          <AgentList
            agents={agents}
            isPending={isPending}
            isFetching={isFetching}
            hasNextPage={(hasNextPage ?? false) && !isPlaceholderData}
            isFetchingNextPage={isFetchingNextPage}
            onLoadMore={fetchNextPage}
            emptyState={
              <Empty>
                <EmptyHeader>
                  <EmptyMedia>
                    <SearchX className="size-12 md:size-9" />
                  </EmptyMedia>
                  <EmptyTitle className="text-base">No agents found</EmptyTitle>
                  <EmptyDescription>
                    {hasActiveFilters
                      ? "No agents match your search. Try different keywords or clear the filters."
                      : "There are no agents to show right now."}
                  </EmptyDescription>
                </EmptyHeader>
                {hasActiveFilters && (
                  <EmptyContent>
                    <Button variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            }
          />
        </div>
      </main>
    </div>
  );
}
