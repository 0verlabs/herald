import { InputGroupAddon } from "@0verlabs/herald-ui/components/input-group";
import { cn } from "@0verlabs/herald-ui/lib/utils";

/** Bottom action row of the composer (attach, model select, send, ...). */
export function MessageInputToolbar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <InputGroupAddon align="block-end" className={cn("gap-1 px-2 pb-2", className)}>
      {children}
    </InputGroupAddon>
  );
}
