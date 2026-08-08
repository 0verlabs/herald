import { useQuery } from "@tanstack/react-query";

import type { Agent, AgentId } from "../types/agent";
import { agents } from "../mocks/agents";

async function fetchAgent(agentId: AgentId) {
  return await new Promise<Agent | undefined>((resolve) => {
    setTimeout(() => {
      resolve(agents.find((agent) => agent.id === agentId));
    }, 400);
  });
}

/** Single agent lookup for the `/agents/$agentId` header. */
export function useAgent(agentId: AgentId) {
  return useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => fetchAgent(agentId),
  });
}
