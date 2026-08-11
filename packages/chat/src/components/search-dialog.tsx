import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@hrld/ui/components/command";
import { cn } from "@hrld/ui/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { useState } from "react";

import type { ChatSummary } from "../types/chat";
import { useChats } from "../providers/chats-provider";

/**
 * Substring match, ranked so earlier hits sort first. Replaces cmdk's default
 * fuzzy filter, which matches scattered letters ("swa" hitting "Stake ETH and
 * auto-compound rewards") and can't be highlighted.
 */
function matchScore(value: string, search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return 1;

  const index = value.toLowerCase().indexOf(needle);
  if (index === -1) return 0;

  return 1 - index / value.length;
}

/** Bolds the portion of the title matching the current query. */
function HighlightedTitle({ title, query }: { title: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const start = needle ? title.toLowerCase().indexOf(needle) : -1;

  if (start === -1) {
    return <>{title}</>;
  }

  const end = start + needle.length;

  return (
    <>
      {title.slice(0, start)}
      <span className="font-semibold text-foreground">{title.slice(start, end)}</span>
      {title.slice(end)}
    </>
  );
}

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat?: (chat: ChatSummary) => void;
}

export function SearchDialog({ open, onOpenChange, onSelectChat }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const { chats } = useChats();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search chats"
      description="Search your chat history by title."
      showCloseButton
      className={cn(
        "sm:max-w-2xl",
        // Center the dialog's close button against the taller search row.
        "[&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:right-4"
      )}
    >
      <Command
        filter={matchScore}
        className={cn(
          "p-0",
          // Grow the search row into a full-width header with a bottom divider.
          "[&_[data-slot=command-input-wrapper]]:p-0",
          "[&_[data-slot=input-group]]:h-14! [&_[data-slot=input-group]]:rounded-none!",
          "[&_[data-slot=input-group]]:border-x-0 [&_[data-slot=input-group]]:border-t-0",
          "[&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:px-2",
          "[&_[data-slot=input-group-addon]_svg]:size-5"
        )}
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search chats"
          className="pr-10 text-base"
        />
        <CommandList className="max-h-96 p-1">
          <CommandEmpty>No chats found.</CommandEmpty>
          <CommandGroup heading={query ? "Search results" : undefined}>
            {chats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={chat.title}
                onSelect={() => {
                  onSelectChat?.(chat);
                  onOpenChange(false);
                }}
                className="text-muted-foreground"
              >
                <span className="flex-1 truncate">
                  <HighlightedTitle title={chat.title} query={query} />
                </span>
                <CommandShortcut>
                  <span className="group-data-selected/command-item:hidden">
                    {formatDistanceToNowStrict(chat.updatedAt, { addSuffix: true })}
                  </span>
                  <span className="hidden group-data-selected/command-item:block">⏎</span>
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
