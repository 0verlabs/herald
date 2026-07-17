import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Button } from "@ivanius.ai/ui/components/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import { AppSidebar } from "../components/app-sidebar";
import "../styles.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const isIndexRoute = useRouterState({
    select: (state) => state.location.pathname === "/",
  });

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <SidebarTrigger className="md:hidden" />
          {isIndexRoute && (
            <div className="ml-auto">
              <Button variant="outline" size="lg">
                <Plus />
                New chat
              </Button>
            </div>
          )}
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
