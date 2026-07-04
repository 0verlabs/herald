import { MessageSquareText, PanelLeft, Plus, Search, Trash2 } from "lucide-react";

import { Kbd } from "@ivanius.ai/ui/components/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@ivanius.ai/ui/components/sidebar";

import { chats } from "../lib/mock-data";
import { NavUser } from "./nav-user";

function SidebarLogo() {
  const { open, toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={open ? "Close sidebar" : "Open sidebar"}
      className="group/logo relative flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-sidebar-accent"
    >
      <img
        src="/logo.svg"
        alt=""
        className="size-7 rounded-md transition-opacity group-data-[collapsible=icon]:group-hover/logo:opacity-0"
      />
      <PanelLeft className="absolute size-4 opacity-0 transition-opacity group-data-[collapsible=icon]:group-hover/logo:opacity-100" />
    </button>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center">
          <div className="flex items-center gap-2">
            <SidebarLogo />
            <span className="font-heading italic text-xl font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              Ivanius
            </span>
          </div>
          <SidebarTrigger className="text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-y-1">
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Search">
                  <Search />
                  <span>Search</span>
                  <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Chat" isActive>
                  <MessageSquareText />
                  <span>Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-sm text-muted-foreground">Chats</SidebarGroupLabel>
          <SidebarGroupAction title="New chat" aria-label="New chat">
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {chats.map((chat) => (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton className="text-sidebar-foreground/80">
                    <span>{chat.title}</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    aria-label={`Delete ${chat.title}`}
                    className="text-sidebar-foreground/50 hover:text-destructive"
                  >
                    <Trash2 />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
