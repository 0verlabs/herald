import { SidebarInset } from "@hrld/ui/components/sidebar";
import { Toaster } from "@hrld/ui/components/toast";
import { createRootRoute, Outlet } from "@tanstack/react-router";

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
