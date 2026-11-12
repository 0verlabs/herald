import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { getSessionAccount } from "@/server/auth";
import { getHeraldEnv } from "@/server/herald-env";

// Every dashboard page sits under this layout, which sends anyone without a
// session to sign-in. The server functions behind the pages check the
// session themselves (`requireSession`); this guard only shapes navigation.
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: async ({ location }) => {
    const [account, heraldEnv] = await Promise.all([getSessionAccount(), getHeraldEnv()]);
    if (!account) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    return { account, heraldEnv };
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { account, heraldEnv } = Route.useRouteContext();

  return (
    <AppShell account={account} heraldEnv={heraldEnv}>
      <Outlet />
    </AppShell>
  );
}
