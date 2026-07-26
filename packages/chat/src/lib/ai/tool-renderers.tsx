import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Wrench } from "lucide-react";

export interface ToolRenderContext {
  toolName: string;
}

/**
 * Per-tool presentation contract for tool call cards. Register a renderer
 * with `ToolRenderersProvider` to customize how a tool's invocation, approval
 * prompt, and result are shown; anything left undefined falls back to the
 * generic JSON rendering.
 */
export interface ToolRenderer<Input = unknown, Output = unknown> {
  icon?: LucideIcon;
  /** Human-readable title; defaults to the tool name. */
  label?: (input: Input, context: ToolRenderContext) => ReactNode;
  /** One-line summary shown in the collapsed/header state. */
  renderSummary?: (input: Input, context: ToolRenderContext) => ReactNode;
  /** Expanded detail of what is being executed/approved (transfer amount, contract, ...). */
  renderInput?: (input: Input, context: ToolRenderContext) => ReactNode;
  renderOutput?: (output: Output, input: Input, context: ToolRenderContext) => ReactNode;
  /** Approval prompt copy, e.g. "Approve this transfer?". */
  approvalMessage?: (input: Input, context: ToolRenderContext) => ReactNode;
}

/** Renderers keyed by tool name, as registered on the provider. */
export type ToolRendererMap = Partial<Record<string, ToolRenderer>>;

export function JsonBlock({ value }: { value: unknown }) {
  if (value === undefined) return null;
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-muted-foreground text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export const fallbackToolRenderer: ToolRenderer = {
  icon: Wrench,
  renderInput: (input) => <JsonBlock value={input} />,
  renderOutput: (output) => <JsonBlock value={output} />,
};
