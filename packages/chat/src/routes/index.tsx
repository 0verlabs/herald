import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, ChevronDown, Paperclip } from "lucide-react";

import { Button } from "@ivanius.ai/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@ivanius.ai/ui/components/input-group";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

const suggestions = ["Swap tokens", "Send crypto", "Delegate to an agent", "Check my balance"];

function ChatComponent() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-20">
      <h1 className="text-4xl font-serif tracking-tight mb-6">
        What can I help with?
      </h1>
      <form className="w-full max-w-2xl">
        <InputGroup className="rounded-2xl bg-card shadow-sm dark:bg-card">
          <InputGroupTextarea
            placeholder="Ask anything"
            aria-label="Message"
            className="max-h-48 min-h-16 px-4 pt-3.5"
          />
          <InputGroupAddon align="block-end" className="gap-1 px-2 pb-2">
            <InputGroupButton size="icon-sm" aria-label="Attach files">
              <Paperclip />
            </InputGroupButton>
            <InputGroupButton size="sm">
              Fable 5
              <ChevronDown />
            </InputGroupButton>
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              aria-label="Send message"
              className="ml-auto rounded-full"
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full font-normal text-muted-foreground"
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </main>
  );
}
