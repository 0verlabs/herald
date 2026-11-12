import type { PaymentLogPage } from "@herald/core/server";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { CoinAmount } from "@/components/money/amount";
import { CoinLogo } from "@/components/money/coin-logo";
import { NetworkAvatar } from "@/components/money/network-logo";
import { ExplorerLink } from "@/components/shared/explorer-link";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUtcDate, formatUtcTime, shortenMiddle } from "@/lib/format";
import { USDC } from "@/lib/stablecoins";

/** A paid URL without its scheme: `api.example.com/weather`. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function PaymentTable({ entries }: { entries: PaymentLogPage["entries"] }) {
  return (
    <>
      <ul className="flex flex-col md:hidden">
        {entries.map((payment) => (
          <li
            key={payment.id}
            className="flex flex-col gap-2 border-b py-4 first:pt-0 last:border-b-0 last:pb-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2">
                <CoinLogo symbol={USDC.symbol} size="sm" />
                <CoinAmount
                  baseUnits={payment.amount}
                  decimals={USDC.decimals}
                  symbol={USDC.symbol}
                  className="font-medium"
                />
              </span>
              <NetworkAvatar label={payment.label ?? payment.network} />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {formatUtcDate(payment.settledAt)}, {formatUtcTime(payment.settledAt)}
              </span>
              <ExplorerLink url={payment.txUrl} hash={payment.txHash} />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              From <span className="font-mono">{shortenMiddle(payment.buyerAddress)}</span>
              {payment.resourceUrl ? ` for ${shortUrl(payment.resourceUrl)}` : null}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Paid by</TableHead>
              <TableHead>For</TableHead>
              <TableHead>Receipt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>
                  <span className="flex flex-col">
                    <span>{formatUtcDate(payment.settledAt)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatUtcTime(payment.settledAt)}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <CoinLogo symbol={USDC.symbol} size="sm" />
                    <CoinAmount
                      baseUnits={payment.amount}
                      decimals={USDC.decimals}
                      symbol={USDC.symbol}
                      className="font-medium"
                    />
                  </span>
                </TableCell>
                <TableCell>
                  <NetworkAvatar label={payment.label ?? payment.network} />
                </TableCell>
                <TableCell className="font-mono text-xs" title={payment.buyerAddress}>
                  {shortenMiddle(payment.buyerAddress)}
                </TableCell>
                <TableCell className="max-w-56 truncate" title={payment.resourceUrl ?? undefined}>
                  {payment.resourceUrl ? (
                    shortUrl(payment.resourceUrl)
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </TableCell>
                <TableCell>
                  <ExplorerLink url={payment.txUrl} hash={payment.txHash} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function PaymentPagination({ log }: { log: PaymentLogPage }) {
  const hasPrevious = log.page > 1;
  const hasNext = log.page < log.pageCount;

  return (
    <Pagination>
      <PaginationContent className="gap-3">
        <PaginationItem>
          {hasPrevious ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/payments" search={{ page: log.page - 1 }} />}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Newer
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <ChevronLeftIcon data-icon="inline-start" />
              Newer
            </Button>
          )}
        </PaginationItem>
        <PaginationItem className="text-sm text-muted-foreground">
          Page {log.page} of {log.pageCount}
        </PaginationItem>
        <PaginationItem>
          {hasNext ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/payments" search={{ page: log.page + 1 }} />}
            >
              Older
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Older
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
