import type { HeraldEnv } from "@herald/core";
import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { HeraldLogo } from "@/components/brand/herald-logo";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar, navSections } from "./app-sidebar";
import { EnvironmentBadge } from "./environment-badge";

/**
 * The signed-in layout: the sidebar with the pages (Admin for Herald admins
 * only), the environment and the account, beside the page.
 */
export function AppShell(props: {
  account: { accountId: string; isAdmin: boolean };
  heraldEnv: HeraldEnv;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const matches = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const section = navSections.find((s) => s.items.some((item) => matches(item.to)));
  const page = section?.items.find((item) => matches(item.to));
  const crumb = page
    ? { group: section?.label, label: page.label }
    : pathname.startsWith("/admin")
      ? { group: "Herald team", label: "Admin" }
      : null;

  return (
    <SidebarProvider>
      <AppSidebar account={props.account} heraldEnv={props.heraldEnv} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md md:px-4">
          <SidebarTrigger aria-label="Show or hide the menu" />
          <Separator
            orientation="vertical"
            className="mx-1 data-vertical:h-4 data-vertical:self-center"
          />
          <HeraldLogo className="h-4 md:hidden" />
          {crumb ? (
            <p className="hidden items-center gap-1.5 text-sm md:flex">
              {crumb.group ? (
                <>
                  <span className="text-muted-foreground">{crumb.group}</span>
                  <span className="text-muted-foreground/60" aria-hidden>
                    /
                  </span>
                </>
              ) : null}
              <span className="font-medium">{crumb.label}</span>
            </p>
          ) : null}
          <div className="ml-auto md:hidden">
            <EnvironmentBadge heraldEnv={props.heraldEnv} />
          </div>
        </header>
        <div
          key={pathname}
          className="page-enter mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 md:px-10 md:py-10"
        >
          {props.children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
