import { useQuery } from "@tanstack/react-query";

import type { FeaturedAgent } from "../types/agent";
import { featuredAgents } from "../mocks/agents";

async function fetchFeaturedAgents() {
  return await new Promise<FeaturedAgent[]>((resolve) => {
    setTimeout(() => {
      resolve([...featuredAgents].sort((a, b) => a.position - b.position));
    }, 1000);
  });
}

/** Featured agents shown in the `/agents` hero carousel. */
export function useFeaturedAgents() {
  return useQuery({
    queryKey: ["featured-agents"],
    queryFn: fetchFeaturedAgents,
  });
}
