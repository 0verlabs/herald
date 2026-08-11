import { useUser } from "@clerk/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@hrld/ui/components/sidebar";
import { Link, useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ClipboardCheck, Compass, PanelLeft, Search, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";

import { useChats } from "../providers/chats-provider";
import { Logo } from "./logo";
import { NavSignIn } from "./nav-sign-in";
import { NavUser } from "./nav-user";
import { SearchDialog } from "./search-dialog";

export function AppSidebar() {
  const { open, toggleSidebar } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const { chats, removeChat } = useChats();
  const navigate = useNavigate();
  const { chatId: activeChatId } = useParams({ strict: false });
  const { isSignedIn } = useUser();
  const matchRoute = useMatchRoute();

  const isAgentsPageActive = !!matchRoute({ to: "/agents", fuzzy: true });

  return (
    <>
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelectChat={(chat) => void navigate({ to: "/chat/$chatId", params: { chatId: chat.id } })}
      />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-8 items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={open ? "Close sidebar" : "Open sidebar"}
              className="group/logo flex items-center gap-1 rounded-lg"
            >
              <span className="relative hidden size-8 shrink-0 items-center justify-center rounded-lg group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:hover:bg-sidebar-accent">
                <Logo />
                <PanelLeft className="absolute size-4 opacity-0 transition-opacity group-data-[collapsible=icon]:group-hover/logo:opacity-100" />
              </span>
              <span className="ml-2 font-heading text-2xl leading-none font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Herald
              </span>
            </button>
            <SidebarTrigger className="text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-y-1">
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Search" onClick={() => setSearchOpen(true)}>
                    <Search />
                    <span>Search</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="New chat" render={<Link to="/" />}>
                    <SquarePen />
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={isAgentsPageActive}
                    tooltip="Explore"
                    render={<Link to="/agents" />}
                  >
                    <Compass />
                    <span>Explore</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Tasks">
                    <ClipboardCheck />
                    <span>Tasks</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="text-sm text-muted-foreground">Chats</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      className="text-sidebar-foreground/80"
                      isActive={chat.id === activeChatId}
                      render={<Link to="/chat/$chatId" params={{ chatId: chat.id }} />}
                    >
                      <span className="truncate">{chat.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      onClick={(e) => {
                        e.currentTarget.blur();
                        removeChat(chat.id);
                        if (chat.id === activeChatId) {
                          void navigate({ to: "/" });
                        }
                      }}
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
        <SidebarFooter>{isSignedIn ? <NavUser /> : <NavSignIn />}</SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
