import type { GasWalletStatus } from "@herald/core/server";
import { TriangleAlertIcon } from "lucide-react";
import { NetworkName } from "@/components/money/network-logo";
import { CopyButton } from "@/components/shared/copy-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTokenAmount, shortenMiddle } from "@/lib/format";

/**
 * Herald's fee wallet (its gas wallet) on each network: one row per
 * network; `wallets` is null while they load.
 */
export function FeeWalletTable({ wallets }: { wallets: GasWalletStatus[] | null }) {
  const low = wallets?.filter((w) => w.ok && w.low) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {low.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Running low</AlertTitle>
          <AlertDescription>
            Top up the fee wallet on {low.map((w) => w.label).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Network</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Warns below</TableHead>
            <TableHead>
              <span className="sr-only">Status</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wallets === null ? (
            <TableRow>
              {Array.from({ length: 5 }, (_, i) => (
                <TableCell key={i}>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
              ))}
            </TableRow>
          ) : (
            wallets.map((wallet) => <FeeWalletRow key={wallet.network} wallet={wallet} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function FeeWalletRow({ wallet }: { wallet: GasWalletStatus }) {
  const amount = (baseUnits: string) =>
    `${formatTokenAmount(baseUnits, wallet.decimals)} ${wallet.symbol}`;

  return (
    <TableRow>
      <TableCell>
        <NetworkName label={wallet.label} />
      </TableCell>
      <TableCell>
        {wallet.address ? (
          <span className="flex items-center gap-1">
            <span className="font-mono text-xs" title={wallet.address}>
              {shortenMiddle(wallet.address)}
            </span>
            <CopyButton label={`${wallet.label} fee wallet`} value={wallet.address} />
          </span>
        ) : (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </TableCell>
      <TableCell className="amount text-right">
        {wallet.ok ? amount(wallet.balance) : null}
      </TableCell>
      <TableCell className="amount text-right text-muted-foreground">
        {wallet.threshold === null ? "No warning set" : amount(wallet.threshold)}
      </TableCell>
      <TableCell className="text-right">
        {!wallet.ok ? (
          <Badge variant="destructive" title={wallet.message}>
            Unavailable
          </Badge>
        ) : wallet.low ? (
          <Badge variant="destructive">Low</Badge>
        ) : (
          <Badge variant="success">OK</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
