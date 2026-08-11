import { Button } from "@hrld/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hrld/ui/components/dialog";
import { toast } from "@hrld/ui/components/toast";
import { useCopyToClipboard } from "@uidotdev/usehooks";
import { Copy } from "lucide-react";

import type { Agent } from "../types/agent";

export interface ServicePrompt {
  service: string;
  text: string;
}

/** One shared template for every service; only the service details change. */
export function buildServicePrompt(input: {
  agentId: Agent["id"];
  agentName: string;
  serviceName: string;
  serviceDescription: string;
}): string {
  return [
    `Call the "${input.agentName}" agent (#${input.agentId}) and use its "${input.serviceName}" service.`,
    "",
    `What it does: ${input.serviceDescription}`,
  ].join("\n");
}

/** Shows the copy-paste prompt for one service. Controlled via `prompt`; null closes it. */
export function ServicePromptDialog({
  prompt,
  onClose,
}: {
  prompt: ServicePrompt | null;
  onClose: () => void;
}) {
  const [, copyText] = useCopyToClipboard();

  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{prompt ? `Use "${prompt.service}"` : ""}</DialogTitle>
          <DialogDescription>
            Paste this prompt into your AI assistant to use this service.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 overflow-y-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
          {prompt?.text}
        </pre>
        <DialogFooter showCloseButton>
          <Button
            onClick={() => {
              if (!prompt) return;
              copyText(prompt.text);
              toast.add({ title: "Prompt copied", type: "success" });
            }}
          >
            <Copy />
            Copy prompt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
