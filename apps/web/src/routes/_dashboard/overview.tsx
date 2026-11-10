import type { ChainBalance, Revenue } from "@herald/core/server";
import { Await, createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsdc } from "@/lib/format";
import { getBalances, getOverview } from "@/server/overview";

export const Route = createFileRoute("/_dashboard/overview")({
  // Balances come from each chain's RPC, so they stream in after the page
  // renders instead of holding it up. Failing chains already come back one
  // by one; a failed call as a whole (say, the Worker unreachable) shows as
  // "Balances unavailable" rather than taking down the page.
  loader: async () => ({
    overview: await getOverview(),
    balances: getBalances().catch(() => null),
  }),
  head: () => ({ meta: [{ title: "Overview · Herald" }] }),
  component: Overview,
});

function Overview() {
  const { overview, balances } = Route.useLoaderData();
  const { accountId, evm, solana, revenue } = overview;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">Overview</h1>
        <p className="text-muted-foreground">
          Buyers pay you in USDC at your Receiving Addresses. Your Provider Account controls every
          one of them through NEAR Chain Signatures; Herald never holds your funds or keys.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider Account</CardTitle>
          <CardDescription>The NEAR account you signed in with.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyableValue label="Provider Account" value={accountId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balances</CardTitle>
          <CardDescription>
            USDC in your Receiving Addresses right now, read live from each chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Await
            promise={balances}
            fallback={<BalanceTable rows={revenue.chains.map((c) => ({ ...c, balance: null }))} />}
          >
            {(loaded) =>
              loaded ? (
                <BalanceTable rows={loaded.map((b) => ({ ...b, balance: b }))} />
              ) : (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Balances unavailable</AlertTitle>
                  <AlertDescription>
                    Herald couldn't read your balances. Reload the page to try again.
                  </AlertDescription>
                </Alert>
              )
            }
          </Await>
        </CardContent>
      </Card>

      <RevenueCard revenue={revenue} />

      <ReceivingAddressCard
        title="EVM Receiving Address"
        description="One address on every EVM chain Herald lists."
        label="EVM Receiving Address"
        address={evm.address}
        networks={evm.networks}
      />
      <ReceivingAddressCard
        title="Solana Receiving Address"
        description="Your address on Solana. USDC arrives in its token account, which Herald creates for you."
        label="Solana Receiving Address"
        address={solana.address}
        networks={solana.networks}
        status={<TokenAccountBadge status={solana.tokenAccountStatus} />}
      />
    </div>
  );
}

/** One row per chain; `balance` is null while it loads. */
function BalanceTable(props: {
  rows: { network: string; label: string; balance: ChainBalance | null }[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Chain</TableHead>
          <TableHead className="text-right">USDC</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map(({ network, label, balance }) => (
          <TableRow key={network}>
            <TableCell>{label}</TableCell>
            <TableCell className="text-right">
              {balance === null ? (
                <Skeleton className="ml-auto h-4 w-20" />
              ) : balance.ok ? (
                <span className="font-mono tabular-nums">{formatUsdc(balance.amount)}</span>
              ) : (
                <span className="flex items-center justify-end gap-2">
                  <span className="text-muted-foreground">{balance.message}</span>
                  <Badge variant="destructive">Unavailable</Badge>
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Revenue per chain from the payments Herald settled, all time and over the last 7 days. */
function RevenueCard({ revenue }: { revenue: Revenue }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
        <CardDescription>USDC from the payments Herald settled for you.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/payments" />}>
            View payments
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chain</TableHead>
              <TableHead className="text-right">Last 7 days</TableHead>
              <TableHead className="text-right">All time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {revenue.chains.map((chain) => (
              <TableRow key={chain.network}>
                <TableCell>{chain.label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatUsdc(chain.last7Days)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatUsdc(chain.allTime)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsdc(revenue.total.last7Days)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsdc(revenue.total.allTime)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

const tokenAccountBadges = {
  created: { label: "Token account ready", variant: "secondary" },
  queued: { label: "Creating token account", variant: "outline" },
  not_queued: { label: "Token account not created yet", variant: "outline" },
  failed: { label: "Token account creation failed", variant: "destructive" },
} as const;

/** Where Herald's creation of the Solana USDC token account stands. */
function TokenAccountBadge(props: { status: keyof typeof tokenAccountBadges }) {
  const { label, variant } = tokenAccountBadges[props.status];
  return <Badge variant={variant}>{label}</Badge>;
}

function ReceivingAddressCard(props: {
  title: string;
  description: string;
  label: string;
  address: string;
  networks: string[];
  status?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
        {props.status ? <CardAction>{props.status}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <CopyableValue label={props.label} value={props.address} />
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <span className="text-muted-foreground">Receives on</span>
        {props.networks.map((network) => (
          <Badge key={network} variant="outline">
            {network}
          </Badge>
        ))}
      </CardFooter>
    </Card>
  );
}
