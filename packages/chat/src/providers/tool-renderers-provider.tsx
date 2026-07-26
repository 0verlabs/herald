import { createContext, useContext } from "react";

import type { ToolRenderer, ToolRendererMap } from "../lib/ai/tool-renderers";
import { fallbackToolRenderer } from "../lib/ai/tool-renderers";

const ToolRenderersContext = createContext<ToolRendererMap>({});

/** Registers per-tool renderers for tool call cards (approvals, results). */
export function ToolRenderersProvider({
  renderers,
  children,
}: {
  renderers: ToolRendererMap;
  children: React.ReactNode;
}) {
  return (
    <ToolRenderersContext.Provider value={renderers}>{children}</ToolRenderersContext.Provider>
  );
}

/** Renderer for a tool, falling back to the generic JSON rendering. */
export function useToolRenderer(toolName: string): ToolRenderer {
  const renderers = useContext(ToolRenderersContext);
  return renderers[toolName] ?? fallbackToolRenderer;
}
