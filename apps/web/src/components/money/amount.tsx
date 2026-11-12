import { formatCoinAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A stablecoin amount with its symbol after it: `12.50 USDC`. */
export function CoinAmount(props: {
  baseUnits: string;
  decimals: number;
  symbol: string;
  className?: string;
}) {
  return (
    <span className={cn("amount whitespace-nowrap", props.className)}>
      {formatCoinAmount(props.baseUnits, props.decimals)}{" "}
      <span className="text-muted-foreground">{props.symbol}</span>
    </span>
  );
}

/**
 * A dollar figure set large, for balances and totals: the cents smaller
 * and quieter than the dollars. Stablecoins count one coin as one dollar.
 */
export function DollarFigure(props: { baseUnits: string; decimals: number; className?: string }) {
  const [whole, fraction] = formatCoinAmount(props.baseUnits, props.decimals).split(".");
  return (
    <span className={cn("figure inline-flex items-baseline leading-none", props.className)}>
      <span className="mr-0.5 text-[0.7em] text-muted-foreground">$</span>
      <span>{whole}</span>
      <span className="text-[0.7em] text-muted-foreground">.{fraction}</span>
    </span>
  );
}
