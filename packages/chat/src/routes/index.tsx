import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@ivanius.ai/ui/components/button";

import { MessageInput } from "../components/message-input";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

const suggestions = ["Swap tokens", "Send crypto", "Delegate to an agent", "Check my balance"];

function ChatComponent() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-20">
      <h1 className="text-4xl font-serif tracking-tight mb-6">What can I help with?</h1>
      <MessageInput
        className="max-w-2xl"
        onSubmit={(values) => {
          console.log(values);
        }}
      />
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
