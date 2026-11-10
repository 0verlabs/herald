import type { PaymentLogPage } from "@herald/core/server";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ReceiptIcon } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsdc, formatUtc, shortenMiddle } from "@/lib/format";
import { getPaymentLog } from "@/server/payments";

const PaymentsSearchSchema = z.object({
  page: z.number().int().positive().default(1).catch(1),
});

export const Route = createFileRoute("/_dashboard/payments")({
  validateSearch: PaymentsSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) => getPaymentLog({ data: { page: deps.page } }),
  head: () => ({ meta: [{ title: "Payments · Herald" }] }),
  component: Payments,
});

function Payments() {
  const log = Route.useLoaderData();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">Payments</h1>
        <p className="text-muted-foreground">
          Every Buyer payment Herald's facilitator settled into your Receiving Addresses, newest
          first.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment log</CardTitle>
          <CardDescription>
            {log.total === 1 ? "1 payment" : `${log.total.toLocaleString("en-US")} payments`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {log.entries.length > 0 ? (
            <>
              <PaymentTable entries={log.entries} />
              {log.pageCount > 1 ? <PaymentPagination log={log} /> : null}
            </>
          ) : log.total > 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No payments on this page</EmptyTitle>
                <EmptyDescription>The log has {log.pageCount} pages.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/payments" search={{ page: 1 }} />}
                >
                  First page
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ReceiptIcon />
                </EmptyMedia>
                <EmptyTitle>No payments yet</EmptyTitle>
                <EmptyDescription>
                  Payments show up here once Herald settles them. Follow the{" "}
                  <Link to="/integration">integration snippet</Link> to take your first one.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentTable({ entries }: { entries: PaymentLogPage["entries"] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">USDC</TableHead>
          <TableHead>Buyer</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell>{formatUtc(payment.settledAt)}</TableCell>
            <TableCell>
              <Badge variant="outline">{payment.label ?? payment.network}</Badge>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatUsdc(payment.amount)}
            </TableCell>
            <TableCell className="font-mono" title={payment.buyerAddress}>
              {shortenMiddle(payment.buyerAddress)}
            </TableCell>
            <TableCell className="max-w-56 truncate" title={payment.resourceUrl ?? undefined}>
              {payment.resourceUrl ?? <span className="text-muted-foreground">Not recorded</span>}
            </TableCell>
            <TableCell className="font-mono">
              {payment.txUrl ? (
                <a
                  href={payment.txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  title={payment.txHash}
                >
                  {shortenMiddle(payment.txHash, 8, 6)}
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                  <span className="sr-only">(opens the block explorer)</span>
                </a>
              ) : (
                <span title={payment.txHash}>{shortenMiddle(payment.txHash, 8, 6)}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PaymentPagination({ log }: { log: PaymentLogPage }) {
  const hasPrevious = log.page > 1;
  const hasNext = log.page < log.pageCount;

  return (
    <Pagination>
      <PaginationContent className="gap-3">
        <PaginationItem>
          {hasPrevious ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/payments" search={{ page: log.page - 1 }} />}
            >
              <ChevronLeftIcon data-icon="inline-start" />
              Newer
            </Button>
          ) : (
            <Button variant="ghost" disabled>
              <ChevronLeftIcon data-icon="inline-start" />
              Newer
            </Button>
          )}
        </PaginationItem>
        <PaginationItem className="text-muted-foreground">
          Page {log.page} of {log.pageCount}
        </PaginationItem>
        <PaginationItem>
          {hasNext ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/payments" search={{ page: log.page + 1 }} />}
            >
              Older
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : (
            <Button variant="ghost" disabled>
              Older
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
