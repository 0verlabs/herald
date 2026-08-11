import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@hrld/ui/components/collapsible";
import { cn } from "@hrld/ui/lib/utils";
import { ChevronDown, CircleCheck, Clock } from "lucide-react";
import { useState } from "react";

interface ChatReasoningProps {
  /** Thinking parts in order; the first one is the one-line summary. */
  steps: string[];
  /** Reasoning text is still being generated. */
  streaming: boolean;
}

export function ChatReasoning({ steps, streaming }: ChatReasoningProps) {
  // Open while the model is thinking; collapses once the answer starts,
  // unless the user has toggled it themselves.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? streaming;

  // The summary line becomes the trigger once reasoning is complete. While
  // streaming, everything stays in the panel under a "Thinking" label.
  const summary = !streaming && steps.length > 1 ? steps[0] : null;
  const panelSteps = summary ? steps.slice(1) : steps;

  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger className="group/reasoning flex max-w-full items-center gap-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
        <span className={cn("truncate", streaming && "shimmer")}>
          {summary ?? (streaming ? "Thinking" : "Reasoning")}
        </span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[panel-open]/reasoning:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <div className="flex flex-col text-sm text-muted-foreground">
          {panelSteps.map((step, index) => (
            // Steps stream in order and are never reordered, so the index is stable.
            <div key={index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <Clock className="mt-1 size-4 shrink-0" />
                {(!streaming || index < panelSteps.length - 1) && (
                  <div className="my-1 w-px flex-1 bg-border" />
                )}
              </div>
              <p className="pb-4">{step}</p>
            </div>
          ))}
          {!streaming && (
            <div className="flex items-center gap-3">
              <CircleCheck className="size-4 shrink-0" />
              <p>Done</p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
