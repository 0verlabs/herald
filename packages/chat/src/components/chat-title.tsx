import { Button } from "@hrld/ui/components/button";
import { Input } from "@hrld/ui/components/input";
import { Pencil } from "lucide-react";
import { useState } from "react";

export function ChatTitle({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  function commit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== title) {
      onRename(trimmed);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        defaultValue={title}
        aria-label="Chat title"
        className="h-8 w-72"
        onFocus={(event) => event.target.select()}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
          }
          if (event.key === "Escape") {
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="group/title flex min-w-0 items-center gap-1">
      <h1 className="truncate text-sm font-medium">{title}</h1>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Rename chat"
        className="shrink-0 text-muted-foreground opacity-0 group-focus-within/title:opacity-100 group-hover/title:opacity-100"
        onClick={() => setEditing(true)}
      >
        <Pencil />
      </Button>
    </div>
  );
}
