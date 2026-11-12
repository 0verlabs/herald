import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const sizes = { sm: "size-5 text-[0.6rem]", md: "size-8 text-xs", lg: "size-10 text-sm" } as const;

/**
 * A stablecoin's logo, as a round avatar: public/logos/tokens/<symbol>.svg.
 * A coin without a file falls back to its first letter on a brand tint.
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
    <Avatar aria-hidden="true" className={cn(sizes[size], className)}>
      <AvatarImage src={`/logos/tokens/${symbol.toLowerCase()}.svg`} alt="" />
      <AvatarFallback className="bg-brand-soft font-semibold text-primary">
        {symbol.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}
