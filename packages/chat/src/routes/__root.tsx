import { createRootRoute, Outlet } from "@tanstack/react-router";

import { SidebarInset } from "@ivanius.ai/ui/components/sidebar";
import { Toaster } from "@ivanius.ai/ui/components/toast";

import { AppSidebar } from "../components/app-sidebar";
import { ClerkPrivyJwtSync } from "../components/clerk-privy-jwt-sync";
import { AppProvider } from "../providers/app-provider";

import "../styles.css";

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
      <Toaster />
    </AppProvider>
  );
}
