import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const sizes = { sm: "size-5 text-[0.6rem]", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

/**
 * A stablecoin's logo, as a round avatar. PLACEHOLDER: the coin's first
 * letter on a brand tint, until the real logo files are added (add an
 * `AvatarImage` here, one file per symbol).
 */
export function CoinLogo({
  symbol,
  size = "md",
  className,
}: {
  symbol: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <Avatar aria-hidden="true" data-placeholder="coin-logo" className={cn(sizes[size], className)}>
      <AvatarFallback className="bg-brand-soft font-semibold text-primary">
        {symbol.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}
