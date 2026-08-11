import { useClerk, useUser } from "@clerk/react";
import { Avatar, AvatarFallback, AvatarImage } from "@hrld/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@hrld/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@hrld/ui/components/sidebar";
import { ChevronsUpDown, CreditCard, LogOut, Settings, Sparkles } from "lucide-react";

import { initialsFrom } from "../lib/user";

export function NavUser() {
  const { isMobile, open } = useSidebar();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();

  if (!user) return null;

  const name = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "Account";
  const initials = initialsFrom(name);

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
              <span className="truncate text-xs text-muted-foreground">Free plan</span>
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
                    <span className="truncate text-xs text-muted-foreground">Free plan</span>
                  </div>
                  {/*<Badge>{plan}</Badge>*/}
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
