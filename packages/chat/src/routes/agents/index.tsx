import { createFileRoute } from "@tanstack/react-router";

import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import { FeaturedAgentsCarousel } from "../../components/featured-agents-carousel";

export const Route = createFileRoute("/agents/")({
  component: AgentsRoute,
});

function AgentsRoute() {
  return (
    <div className="flex h-svh flex-col">
      <header className="z-1 flex h-14 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger className="md:hidden" />
        <h1 className="truncate font-medium md:hidden">Explore</h1>
      </header>
      <div className="z-0 -mt-14">
        <FeaturedAgentsCarousel />
      </div>
      <main className="h-svh overflow-y-auto px-4 py-4"></main>
    </div>
  );
}
