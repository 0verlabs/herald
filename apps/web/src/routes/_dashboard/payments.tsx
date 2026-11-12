import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, ReceiptTextIcon } from "lucide-react";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { PaymentPagination, PaymentTable } from "@/components/payments/payment-table";
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
  const count = log.total === 1 ? "1 payment" : `${log.total.toLocaleString("en-US")} payments`;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment your customers made, newest first, with a receipt on the network it was paid on."
      />
      <Card>
        <CardHeader>
          <CardTitle>All payments</CardTitle>
          <CardDescription>{count}</CardDescription>
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
                <EmptyDescription>There are {log.pageCount} pages of payments.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/payments" search={{ page: 1 }} />}
                >
                  Go to the newest
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ReceiptTextIcon />
                </EmptyMedia>
                <EmptyTitle>No payments yet</EmptyTitle>
                <EmptyDescription>
                  Payments show up here the moment a customer pays. Connect your API to take your
                  first one.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button nativeButton={false} render={<Link to="/integration" />}>
                  Connect your API
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  );
}
