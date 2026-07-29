import { useClerk, useUser } from "@clerk/react";
import { ChevronsUpDown, CreditCard, LogOut, Settings, Sparkles } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@ivanius.ai/ui/components/avatar";
import { Badge } from "@ivanius.ai/ui/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ivanius.ai/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@ivanius.ai/ui/components/sidebar";

import { currentUser } from "../lib/mock-data";
import { initialsFrom } from "../lib/user";

export function NavUser() {
  const { isMobile, open } = useSidebar();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();

  // Rendered under `<Show when="signed-in">`, so this only trips during the
  // brief window before the user resource resolves.
  if (!user) {
    return null;
  }

  const name = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "Account";
  const initials = initialsFrom(name);
  // Balance and plan are ours, not Clerk's — still mocked until billing lands.
  const { balance, plan } = currentUser;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="rounded-lg" />}>
            <Avatar className="size-8">
              <AvatarImage src={user.imageUrl} alt={name} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">{balance}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60 rounded-lg"
            side={isMobile ? "bottom" : open ? "top" : "right"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="size-8">
                    <AvatarImage src={user.imageUrl} alt={name} />
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate font-medium text-foreground">{name}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {balance}
                    </span>
                  </div>
                  <Badge>{plan}</Badge>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <CreditCard />
                Purchase Credits
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade plan
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openUserProfile()}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => void signOut({ redirectUrl: "/" })}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
