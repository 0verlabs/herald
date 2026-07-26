import type { ToolRendererMap } from "../lib/ai/tool-renderers";
import { calculatorToolRenderer } from "../components/tools/calculator";
import { ChatsProvider } from "./chats-provider";
import { ModelProvider } from "./model-provider";
import { ToolRenderersProvider } from "./tool-renderers-provider";

/** Tool call renderers keyed by the agent's tool names. */
const toolRenderers: ToolRendererMap = {
  calculate: calculatorToolRenderer,
};

/** Composes every app-level provider; keeps the root route declarative. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ModelProvider>
      <ToolRenderersProvider renderers={toolRenderers}>
        <ChatsProvider>{children}</ChatsProvider>
      </ToolRenderersProvider>
    </ModelProvider>
  );
}
