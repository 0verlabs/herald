import { FieldLabel } from "@hrld/ui/components/field";
import { InputGroupTextarea } from "@hrld/ui/components/input-group";
import { cn } from "@hrld/ui/lib/utils";
import { useId } from "react";

interface MessageInputTextareaProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Called on Enter (Shift+Enter falls through to a newline). */
  onSend?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function MessageInputTextarea({
  value,
  onValueChange,
  onSend,
  placeholder = "Ask anything",
  disabled,
  className,
}: MessageInputTextareaProps) {
  const textareaId = useId();

  return (
    <>
      <FieldLabel htmlFor={textareaId} className="sr-only">
        Message
      </FieldLabel>
      <InputGroupTextarea
        id={textareaId}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        className={cn("max-h-48 min-h-16 px-4 pt-3.5", className)}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend?.();
          }
        }}
      />
    </>
  );
}
