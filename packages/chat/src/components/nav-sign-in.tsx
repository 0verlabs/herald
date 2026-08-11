import { SignInButton } from "@clerk/react";
import { LogIn } from "lucide-react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@0verlabs/herald-ui/components/sidebar";

/**
 * Signed-out counterpart to `NavUser`. `SignInButton` is unstyled — it clones
 * our menu button and attaches the redirect to Clerk's hosted sign-in page —
 * so the footer keeps the same `size="lg"` geometry either way.
 */
export function NavSignIn() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SignInButton mode="modal">
          <SidebarMenuButton size="lg" tooltip="Sign in" className="rounded-lg">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <LogIn className="size-4" />
            </span>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">Sign in</span>
              <span className="truncate text-xs text-muted-foreground">to save your chats</span>
            </div>
          </SidebarMenuButton>
        </SignInButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
