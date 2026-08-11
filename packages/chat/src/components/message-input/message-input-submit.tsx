import { ArrowUp } from "lucide-react";

import { InputGroupButton } from "@0verlabs/herald-ui/components/input-group";

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
