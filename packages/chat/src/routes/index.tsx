import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Button } from "@ivanius.ai/ui/components/button";
import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import { useChats } from "../components/chats-provider";
import { MessageInput } from "../components/message-input";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

const suggestions = ["Swap tokens", "Send crypto", "Delegate to an agent", "Check my balance"];

function ChatComponent() {
  const navigate = useNavigate();
  const { startChat } = useChats();

  function begin(message: string) {
    const chatId = startChat(message);
    void navigate({ to: "/chat/$chatId", params: { chatId } });
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <SidebarTrigger className="md:hidden" />
        <div className="ml-auto">
          <Button variant="outline" size="lg">
            <Plus />
            New chat
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-20">
        <h1 className="mb-6 font-serif text-4xl tracking-tight">What can I help with?</h1>
        <MessageInput
          className="max-w-2xl"
          onSubmit={({ message }) => {
            if (message.length > 0) begin(message);
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
              onClick={() => begin(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </main>
    </div>
  );
}
