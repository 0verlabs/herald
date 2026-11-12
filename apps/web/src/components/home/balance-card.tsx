import { Link } from "@tanstack/react-router";
import { AlertCircleIcon, ArrowRightIcon, BanknoteArrowUpIcon } from "lucide-react";
import { DollarFigure } from "@/components/money/amount";
import { StablecoinBalances } from "@/components/money/stablecoin-balances";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { totalAcross, type StablecoinHolding } from "@/lib/stablecoins";

/**
 * Everything the account holds, in dollars, then each stablecoin with the
 * networks it sits on. `holdings` is null when the balances couldn't be read.
 */
export function BalanceCard({ holdings }: { holdings: StablecoinHolding[] | null }) {
  const loading = holdings?.some((h) => h.loading) ?? false;
  const total = holdings ? totalAcross(holdings) : null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Total balance</CardTitle>
        <CardDescription>What your customers paid you, ready to withdraw.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-h-14 items-end">
            {holdings === null ? (
              <span className="figure text-5xl text-muted-foreground">—</span>
            ) : loading || !total ? (
              <Skeleton className="h-12 w-56" />
            ) : (
              <DollarFigure
                baseUnits={total.baseUnits}
                decimals={total.decimals}
                className="text-5xl sm:text-6xl"
              />
            )}
          </div>
          <div className="flex gap-2">
            <Button size="lg" nativeButton={false} render={<Link to="/withdraw" />}>
              <BanknoteArrowUpIcon data-icon="inline-start" />
              Withdraw
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link to="/payments" />}
              className="group/cta"
            >
              See payments
              <ArrowRightIcon
                data-icon="inline-end"
                className="transition-transform group-hover/cta:translate-x-0.5"
              />
            </Button>
          </div>
        </div>
        {holdings === null ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Balances unavailable</AlertTitle>
            <AlertDescription>
              Herald couldn't read your balances just now. Reload the page to try again.
            </AlertDescription>
          </Alert>
        ) : (
          <StablecoinBalances holdings={holdings} />
        )}
      </CardContent>
    </Card>
  );
}
