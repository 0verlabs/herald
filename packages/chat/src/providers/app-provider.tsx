import { ClerkProvider } from "@clerk/react";

import { calculatorToolRenderer } from "../components/tools/calculator";
import type { ToolRendererMap } from "../lib/ai/tool-renderers";
import { ChatsProvider } from "./chats-provider";
import { ModelProvider } from "./model-provider";
import { ToolRenderersProvider } from "./tool-renderers-provider";
import { clerkAppearance } from "../lib/clerk-appearance";

/** Tool call renderers keyed by the agent's tool names. */
const toolRenderers = {
  calculate: calculatorToolRenderer,
};

/** Composes every app-level provider; keeps the root route declarative. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      <ModelProvider>
        <ToolRenderersProvider renderers={toolRenderers as ToolRendererMap}>
          <ChatsProvider>{children}</ChatsProvider>
        </ToolRenderersProvider>
      </ModelProvider>
    </ClerkProvider>
  );
}
