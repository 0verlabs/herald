import { createFileRoute } from "@tanstack/react-router";
import { ArrowUp, ChevronDown, Paperclip, Plus } from "lucide-react";

import { Button } from "@ivanius.ai/ui/components/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";
import { Textarea } from "@ivanius.ai/ui/components/textarea";

import { AppSidebar } from "../components/app-sidebar";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

const suggestions = ["Generate image", "Research a topic", "Create a video", "Check my balance"];

function ChatComponent() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
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
          <form className="w-full max-w-2xl">
            <div className="rounded-2xl border bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
              <Textarea
                placeholder="Ask anything"
                aria-label="Message"
                className="max-h-48 min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
              />
              <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-0.5">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach files"
                    className="text-muted-foreground"
                  >
                    <Paperclip />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                    Fable 5
                    <ChevronDown />
                  </Button>
                </div>
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send message"
                  className="rounded-full"
                >
                  <ArrowUp />
                </Button>
              </div>
            </div>
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
      </SidebarInset>
    </SidebarProvider>
  );
}
