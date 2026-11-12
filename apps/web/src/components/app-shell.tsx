import type { HeraldEnv } from "@herald/core";
import { Link, useRouter, type LinkProps } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LogOutIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { nearConnector } from "@/lib/near-wallet";
import { signOut } from "@/server/auth";

/**
 * The signed-in layout: a header with the Herald environment, the page
 * links (Admin for Herald admins only) and the account, above the page.
 */
export function AppShell(props: {
  account: { accountId: string; isAdmin: boolean };
  heraldEnv: HeraldEnv;
  children: ReactNode;
}) {
  const { account, heraldEnv } = props;

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
            <NavLink to="/overview">Overview</NavLink>
            <NavLink to="/payments">Payments</NavLink>
            <NavLink to="/sweep">Sweep</NavLink>
            <NavLink to="/integration">Integration</NavLink>
            <NavLink to="/api-keys">API keys</NavLink>
            {account.isAdmin ? <NavLink to="/admin">Admin</NavLink> : null}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="truncate text-muted-foreground">{account.accountId}</span>
            <SignOutButton heraldEnv={heraldEnv} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl p-6">{props.children}</main>
    </div>
  );
}

function NavLink(props: { to: LinkProps["to"]; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      nativeButton={false}
      render={<Link to={props.to} activeProps={{ "aria-current": "page" }} />}
    >
      {props.children}
    </Button>
  );
}

function SignOutButton({ heraldEnv }: { heraldEnv: HeraldEnv }) {
  const router = useRouter();
  const endSession = useServerFn(signOut);
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await endSession();
      // Forget the wallet too, so the next sign-in can pick another account.
      // The session is already gone if this fails.
      await (await nearConnector(heraldEnv)).disconnect().catch(() => undefined);
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
