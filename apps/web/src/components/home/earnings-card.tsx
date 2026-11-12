import type { Revenue } from "@herald/core/server";
import { CoinAmount, DollarFigure } from "@/components/money/amount";
import { NetworkName } from "@/components/money/network-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { USDC } from "@/lib/stablecoins";

/** What customers paid, in the last 7 days and all time, and on which networks. */
export function EarningsCard({ revenue }: { revenue: Revenue }) {
  const earning = revenue.chains.filter((chain) => BigInt(chain.allTime) > 0n);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money in</CardTitle>
        <CardDescription>What customers paid you through Herald.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-muted-foreground">Last 7 days</dt>
            <dd>
              <DollarFigure
                baseUnits={revenue.total.last7Days}
                decimals={USDC.decimals}
                className="text-3xl"
              />
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-muted-foreground">All time</dt>
            <dd>
              <DollarFigure
                baseUnits={revenue.total.allTime}
                decimals={USDC.decimals}
                className="text-3xl"
              />
            </dd>
          </div>
        </dl>
        <Separator />
        {earning.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {earning.map((chain) => (
              <li key={chain.network} className="flex items-center justify-between gap-3">
                <NetworkName label={chain.label} />
                <CoinAmount
                  baseUnits={chain.allTime}
                  decimals={USDC.decimals}
                  symbol={USDC.symbol}
                  className="text-sm"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No payments yet. Each network shows up here after its first one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
