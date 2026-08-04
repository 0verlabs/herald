import { createRootRoute, Outlet } from "@tanstack/react-router";

import { SidebarInset } from "@ivanius.ai/ui/components/sidebar";

import { AppSidebar } from "../components/app-sidebar";
import { AppProvider } from "../providers/app-provider";
import "../styles.css";
import { ClerkPrivyJwtSync } from "../components/clerk-privy-jwt-sync";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppProvider>
      <ClerkPrivyJwtSync />
      <AppSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </AppProvider>
  );
}
