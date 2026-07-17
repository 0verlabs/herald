import { ChevronsUpDown, CreditCard, LogOut, Settings, Sparkles } from "lucide-react";

import { Avatar, AvatarFallback } from "@ivanius.ai/ui/components/avatar";
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

export function NavUser() {
  const { isMobile, open } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="rounded-full" />}>
            <Avatar className="size-8">
              <AvatarFallback>{currentUser.initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{currentUser.name}</span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {currentUser.balance}
              </span>
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
                    <AvatarFallback>{currentUser.initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate font-medium text-foreground">{currentUser.name}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {currentUser.balance}
                    </span>
                  </div>
                  <Badge>{currentUser.plan}</Badge>
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
            <DropdownMenuItem>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
