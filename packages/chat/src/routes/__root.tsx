import { createRootRoute, Outlet } from "@tanstack/react-router";

import { SidebarInset, SidebarProvider } from "@ivanius.ai/ui/components/sidebar";

import { AppSidebar } from "../components/app-sidebar";
import { AppProvider } from "../providers/app-provider";
import "../styles.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </AppProvider>
  );
}
