import { InputGroupAddon } from "@ivanius.ai/ui/components/input-group";
import { cn } from "@ivanius.ai/ui/lib/utils";

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
