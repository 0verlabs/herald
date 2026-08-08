import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { AgentId, AgentService } from "../types/agent";
import { SERVICES_PAGE_SIZE } from "../config/agents";
import { agentServices } from "../mocks/agents";

export interface AgentServicesPage {
  services: AgentService[];
  total: number;
}

/** Mocked server call: slices one page of an agent's services. */
async function fetchAgentServices(
  agentId: AgentId,
  page: number,
  pageSize: number
): Promise<AgentServicesPage> {
  return await new Promise((resolve) => {
    setTimeout(() => {
      const all = agentServices[agentId] ?? [];
      const offset = (page - 1) * pageSize;

      resolve({
        services: all.slice(offset, offset + pageSize),
        total: all.length,
      });
    }, 400);
  });
}

/** Per-call services offered by one agent, for the `/agents/$agentId` services grid. */
export function useAgentServices(agentId: AgentId, page: number) {
  return useQuery({
    queryKey: ["agent-services", agentId, { page, pageSize: SERVICES_PAGE_SIZE }],
    queryFn: () => fetchAgentServices(agentId, page, SERVICES_PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
