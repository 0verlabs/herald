import { useQuery } from "@tanstack/react-query";

import type { Agent } from "../types/agent";
import { featuredAgents } from "../mocks/agents";

async function fetchFeaturedAgents() {
  return await new Promise<Agent[]>((resolve) => {
    setTimeout(() => {
      resolve(featuredAgents);
    }, 400);
  });
}

/** Featured agents shown in the `/agents` hero carousel. */
export function useFeaturedAgents() {
  return useQuery({
    queryKey: ["featured-agents"],
    queryFn: fetchFeaturedAgents,
  });
}
