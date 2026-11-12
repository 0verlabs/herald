import type { SweepEntry } from "@herald/core/server";
import { BanknoteArrowUpIcon } from "lucide-react";
import { CoinAmount } from "@/components/money/amount";
import { NetworkAvatar } from "@/components/money/network-logo";
import { ExplorerLink } from "@/components/shared/explorer-link";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsdc, formatUtcDate, formatUtcTime, shortenMiddle } from "@/lib/format";
import { USDC } from "@/lib/stablecoins";
import { inPlainWords } from "@/lib/plain-words";
import { inFlight, statusBadges } from "./withdraw-shared";

/** Your latest withdrawals, newest first, with where each one stands. */
export function WithdrawalHistory({ sweeps }: { sweeps: SweepEntry[] }) {
  if (sweeps.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BanknoteArrowUpIcon />
          </EmptyMedia>
          <EmptyTitle>No withdrawals yet</EmptyTitle>
          <EmptyDescription>
            Withdrawals you start show up here, and update on their own until they arrive.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <ul className="flex flex-col md:hidden">
        {sweeps.map((sweep) => (
          <WithdrawalItem key={sweep.id} sweep={sweep} />
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>From</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Receipts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sweeps.map((sweep) => {
              const badge = statusBadges[sweep.status];
              return (
                <TableRow key={sweep.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{formatUtcDate(sweep.createdAt)}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatUtcTime(sweep.createdAt)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <NetworkAvatar label={sweep.label} />
                  </TableCell>
                  <TableCell className="text-right">
                    <CoinAmount
                      baseUnits={sweep.amount}
                      decimals={USDC.decimals}
                      symbol={USDC.symbol}
                      className="font-medium"
                    />
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <NetworkAvatar label={sweep.destinationLabel} />
                      <span
                        className="font-mono text-xs text-muted-foreground"
                        title={sweep.destinationAddress}
                      >
                        {shortenMiddle(sweep.destinationAddress)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex max-w-64 flex-col items-start gap-1 whitespace-normal">
                      <Badge variant={badge.variant}>
                        {inFlight(sweep) ? <Spinner data-icon="inline-start" /> : null}
                        {badge.label}
                      </Badge>
                      {sweep.status === "delivered" && sweep.deliveredAmount ? (
                        <span className="amount text-xs text-muted-foreground">
                          {formatUsdc(sweep.deliveredAmount)} USDC arrived
                        </span>
                      ) : null}
                      {sweep.error ? (
                        <span className="text-xs text-muted-foreground">
                          {inPlainWords(sweep.error)}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <Receipt label="Approval" url={sweep.nearTxUrl} hash={sweep.nearTxHash} />
                      <Receipt label="Sent" url={sweep.sourceTxUrl} hash={sweep.sourceTxHash} />
                      <Receipt
                        label="Bridge"
                        url={sweep.oneClickUrl}
                        hash={sweep.oneClickDepositAddress}
                      />
                      <Receipt
                        label="Arrived"
                        url={sweep.deliveryTxUrl}
                        hash={sweep.deliveryTxHash}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** One withdrawal as a stacked row, for phones. */
function WithdrawalItem({ sweep }: { sweep: SweepEntry }) {
  const badge = statusBadges[sweep.status];
  return (
    <li className="flex flex-col gap-2.5 border-b py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <NetworkAvatar label={sweep.label} />
        <CoinAmount
          baseUnits={sweep.amount}
          decimals={USDC.decimals}
          symbol={USDC.symbol}
          className="font-medium"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {formatUtcDate(sweep.createdAt)}, {formatUtcTime(sweep.createdAt)}
        </span>
        <Badge variant={badge.variant}>
          {inFlight(sweep) ? <Spinner data-icon="inline-start" /> : null}
          {badge.label}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        To {sweep.destinationKind === "same_chain" ? null : `${sweep.destinationLabel} · `}
        <span className="font-mono" title={sweep.destinationAddress}>
          {shortenMiddle(sweep.destinationAddress)}
        </span>
        {sweep.status === "delivered" && sweep.deliveredAmount
          ? `. ${formatUsdc(sweep.deliveredAmount)} USDC arrived.`
          : null}
      </p>
      {sweep.error ? (
        <p className="text-xs text-muted-foreground">{inPlainWords(sweep.error)}</p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Receipt label="Approval" url={sweep.nearTxUrl} hash={sweep.nearTxHash} />
        <Receipt label="Sent" url={sweep.sourceTxUrl} hash={sweep.sourceTxHash} />
        <Receipt label="Bridge" url={sweep.oneClickUrl} hash={sweep.oneClickDepositAddress} />
        <Receipt label="Arrived" url={sweep.deliveryTxUrl} hash={sweep.deliveryTxHash} />
      </div>
    </li>
  );
}

function Receipt(props: { label: string; url: string | null; hash: string | null }) {
  if (!props.url || !props.hash) return null;
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted-foreground">{props.label}</span>
      <ExplorerLink url={props.url} hash={props.hash} />
    </span>
  );
}
