import { Badge } from "@hrld/ui/components/badge";
import { Button } from "@hrld/ui/components/button";
import { Card, CardContent, CardFooter } from "@hrld/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@hrld/ui/components/collapsible";
import { Spinner } from "@hrld/ui/components/spinner";
import { cn } from "@hrld/ui/lib/utils";
import { getToolName } from "ai";
import { Ban, Check, ChevronDown, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import type { ChatToolPart } from "../lib/ai/message";
import type { ToolRenderContext } from "../lib/ai/tool-renderers";
import { isPendingToolPart } from "../lib/ai/message";
import { useToolRenderer } from "../providers/tool-renderers-provider";

interface ChatToolCallProps {
  part: ChatToolPart;
  /** Approval actions are unavailable (a response is running). */
  disabled?: boolean;
  onApprove?: (approvalId: string, approved: boolean) => void;
}

export function ChatToolCall({ part, disabled = false, onApprove }: ChatToolCallProps) {
  const toolName = getToolName(part);
  const renderer = useToolRenderer(toolName);
  const context: ToolRenderContext = { toolName };

  const pending = isPendingToolPart(part);
  // Open while the call runs or awaits approval; collapses once terminal,
  // unless the user has toggled it themselves.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? pending;

  const Icon = renderer.icon;
  const label = renderer.label?.(part.input, context) ?? toolName;
  const summary = renderer.renderSummary?.(part.input, context);
  const inputDetail = renderer.renderInput?.(part.input, context);

  return (
    <Collapsible open={open} onOpenChange={setUserOpen}>
      <CollapsibleTrigger className="group/tool flex max-w-full items-center gap-2 text-left text-muted-foreground text-sm transition-colors hover:text-foreground">
        {Icon && <Icon className="size-4 shrink-0" />}
        <span className={cn("truncate", part.state === "input-streaming" && "shimmer")}>
          {label}
        </span>
        {summary != null && <span className="truncate text-xs">{summary}</span>}
        <ToolStateIndicator part={part} />
        <ChevronDown className="size-4 shrink-0 transition-transform group-data-[panel-open]/tool:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <Card size="sm" className="max-w-full">
          <CardContent className="flex flex-col gap-3">
            {inputDetail}
            {part.state === "approval-requested" && (
              <p className="text-sm">
                {renderer.approvalMessage?.(part.input, context) ??
                  `Allow the assistant to run ${toolName}?`}
              </p>
            )}
            {part.state === "output-available" &&
              renderer.renderOutput?.(part.output, part.input, context)}
            {part.state === "output-error" && (
              <p className="text-destructive text-sm">{part.errorText}</p>
            )}
            {part.state === "output-denied" && part.approval.reason && (
              <p className="text-muted-foreground text-sm">{part.approval.reason}</p>
            )}
          </CardContent>
          {part.state === "approval-requested" && (
            <CardFooter className="justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onApprove?.(part.approval.id, false)}
              >
                Deny
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => onApprove?.(part.approval.id, true)}
              >
                Approve
              </Button>
            </CardFooter>
          )}
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolStateIndicator({ part }: { part: ChatToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <Spinner className="size-3.5 shrink-0" />;
    case "approval-requested":
      return (
        <Badge variant="outline">
          <TriangleAlert />
          Approval required
        </Badge>
      );
    case "approval-responded":
      // A denial is terminal on the client (the turn is not resumed), so it
      // renders like output-denied; an approval is waiting on execution.
      if (!part.approval.approved) {
        return (
          <Badge variant="destructive">
            <Ban />
            Denied
          </Badge>
        );
      }
      return (
        <span className="flex shrink-0 items-center gap-1 text-xs">
          Approved
          <Spinner className="size-3.5" />
        </span>
      );
    case "output-available":
      return (
        <Badge variant="secondary">
          <Check />
          Done
        </Badge>
      );
    case "output-denied":
      return (
        <Badge variant="destructive">
          <Ban />
          Denied
        </Badge>
      );
    case "output-error":
      return (
        <Badge variant="destructive">
          <X />
          Error
        </Badge>
      );
  }
}
