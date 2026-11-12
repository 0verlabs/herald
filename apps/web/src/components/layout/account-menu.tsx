import type { HeraldEnv } from "@herald/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BookOpenIcon, ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/shared/copy-field";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { DOCS_URL } from "@/lib/links";
import { nearConnector } from "@/lib/near-wallet";
import { signOut } from "@/server/auth";

function AccountAvatar({ accountId, className }: { accountId: string; className?: string }) {
  const initials = accountId
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/** The signed-in NEAR account at the foot of the sidebar, with the docs and sign out. */
export function AccountMenu(props: { accountId: string; heraldEnv: HeraldEnv }) {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const endSession = useServerFn(signOut);
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await endSession();
      // Forget the wallet too, so the next sign-in can pick another account.
      // The session is already gone if this fails.
      await (await nearConnector(props.heraldEnv)).disconnect().catch(() => undefined);
      await router.navigate({ to: "/sign-in" });
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
          />
        }
      >
        <AccountAvatar accountId={props.accountId} className="size-8" />
        <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
          <span className="truncate font-medium">{props.accountId}</span>
          <span className="truncate text-xs text-muted-foreground">NEAR account</span>
        </span>
        <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-72 p-1.5"
        side={isMobile ? "bottom" : "right"}
        align="end"
        sideOffset={8}
      >
        <div className="flex items-center gap-3 px-2 py-2.5">
          <AccountAvatar accountId={props.accountId} className="size-10" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{props.accountId}</span>
            <span className="text-xs text-muted-foreground">NEAR account</span>
          </span>
          <CopyButton label="account name" value={props.accountId} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="h-9 gap-2.5 px-2.5 text-sm"
            render={<a href={DOCS_URL} target="_blank" rel="noreferrer" />}
          >
            <BookOpenIcon />
            Docs
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-9 gap-2.5 px-2.5 text-sm"
            disabled={pending}
            onClick={handleSignOut}
          >
            {pending ? <Spinner /> : <LogOutIcon />}
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
