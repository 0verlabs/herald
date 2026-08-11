import { InputGroupButton } from "@hrld/ui/components/input-group";
import { ArrowUp } from "lucide-react";

/** Send button; submits the enclosing form. */
export function MessageInputSubmit({ disabled }: { disabled?: boolean }) {
  return (
    <InputGroupButton
      type="submit"
      variant="default"
      size="icon-sm"
      aria-label="Send message"
      disabled={disabled}
      className="ml-auto rounded-full"
    >
      <ArrowUp />
    </InputGroupButton>
  );
}
