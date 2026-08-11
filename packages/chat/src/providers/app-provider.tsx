import { ClerkProvider } from "@clerk/react";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { zeroGTestnet } from "viem/chains";

import { SidebarProvider } from "@0verlabs/herald-ui/components/sidebar";

import type { ToolRendererMap } from "../lib/ai/tool-renderers";
import { checkBalanceToolRenderer } from "../components/tools/check-balance";
import { sendTokenToolRenderer } from "../components/tools/send-token";
import { clerkAppearance } from "../lib/clerk";
import { ChatsProvider } from "./chats-provider";
import { ModelProvider } from "./model-provider";
import { ToolRenderersProvider } from "./tool-renderers-provider";

/** Tool call renderers keyed by the agent's tool names. */
const toolRenderers = {
  check_balance: checkBalanceToolRenderer,
  send_token: sendTokenToolRenderer,
};

const queryClient = new QueryClient();

/** Composes every app-level provider; keeps the root route declarative. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ClerkProvider
        publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
        afterSignOutUrl="/"
        appearance={clerkAppearance}
      >
        <PrivyProvider
          appId={import.meta.env.VITE_PRIVY_APP_ID}
          clientId={import.meta.env.VITE_PRIVY_CLIENT_ID}
          config={{
            defaultChain: zeroGTestnet,
            supportedChains: [zeroGTestnet],
          }}
        >
          <ModelProvider>
            <ToolRenderersProvider renderers={toolRenderers as ToolRendererMap}>
              <ChatsProvider>
                <SidebarProvider>{children}</SidebarProvider>
              </ChatsProvider>
            </ToolRenderersProvider>
          </ModelProvider>
        </PrivyProvider>
      </ClerkProvider>
    </QueryClientProvider>
  );
}
