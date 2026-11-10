import type { HeraldEnv } from "@herald/core";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { nearConnector } from "@/lib/near-wallet";
import { getSessionAccount, signOut } from "@/server/auth";
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
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-6 py-3">
          <Link to="/overview" className="font-heading font-medium">
            Herald
          </Link>
          <Badge variant="secondary">{heraldEnv}</Badge>
          <Separator orientation="vertical" className="h-5" />
          <nav className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link to="/overview" activeProps={{ "aria-current": "page" }} />}
            >
              Overview
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link to="/integration" activeProps={{ "aria-current": "page" }} />}
            >
              Integration
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link to="/api-keys" activeProps={{ "aria-current": "page" }} />}
            >
              API keys
            </Button>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="truncate text-muted-foreground">{account.accountId}</span>
            <SignOutButton network={heraldEnv} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-6">
        <Outlet />
      </main>
    </div>
  );
}

function SignOutButton({ network }: { network: HeraldEnv }) {
  const router = useRouter();
  const endSession = useServerFn(signOut);
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await endSession();
      // Forget the wallet too, so the next sign-in can pick another account.
      // The session is already gone if this fails.
      await (await nearConnector(network)).disconnect().catch(() => undefined);
      await router.navigate({ to: "/sign-in" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleSignOut}>
      {pending ? <Spinner data-icon="inline-start" /> : <LogOutIcon data-icon="inline-start" />}
      Sign out
    </Button>
  );
}
