import type { ProviderOverview } from "@herald/core/server";
import { ShieldCheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NetworkLogo } from "@/components/money/network-logo";
import { CopyButton } from "@/components/shared/copy-field";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const solanaSetup = {
  created: null,
  queued: { label: "Setting up USDC", variant: "outline" },
  not_queued: { label: "USDC not set up yet", variant: "outline" },
  failed: { label: "USDC setup failed", variant: "destructive" },
} as const;

/**
 * The addresses customers pay into, one row per kind of network, in Payment
 * Option order: NEAR (where Herald lists it), EVM, then Solana.
 */
export function PaymentAddressesCard({ overview }: { overview: ProviderOverview }) {
  const { near, evm, solana } = overview;
  const setup = solanaSetup[solana.tokenAccountStatus];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment addresses</CardTitle>
        <CardDescription>Where customers' payments land, by network.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y rounded-xl border">
          {near.networks.length > 0 ? (
            <AddressRow
              title="NEAR"
              label="NEAR payment address"
              address={near.address}
              networks={near.networks}
            />
          ) : null}
          <AddressRow
            title="EVM"
            label="EVM payment address"
            address={evm.address}
            networks={evm.networks}
            logo="/logos/networks/evm.svg"
          />
          <AddressRow
            title="Solana"
            label="Solana payment address"
            address={solana.address}
            networks={solana.networks}
            status={
              setup ? (
                <Badge variant={setup.variant} className="mt-0.5">
                  {setup.label}
                </Badge>
              ) : null
            }
          />
        </ul>
      </CardContent>
      <CardFooter className="gap-2 text-sm text-muted-foreground">
        <ShieldCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
        <p>
          Customers pay into these. Your NEAR account, {overview.accountId}, controls them: Herald
          never holds your money or your keys.
        </p>
      </CardFooter>
    </Card>
  );
}

/** One address: its networks, the address itself and a copy button. */
function AddressRow(props: {
  title: string;
  label: string;
  address: string;
  networks: string[];
  /** The one logo for the address; by default the logo of its only network. */
  logo?: string;
  status?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/50 md:grid-cols-[15rem_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <NetworkLogo label={props.title} src={props.logo} size="md" className="shrink-0" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{props.title}</span>
          {props.status ?? (
            <span className="truncate text-xs text-muted-foreground">
              {props.networks.length === 1
                ? "1 network"
                : `${props.networks.length} networks, one address`}
            </span>
          )}
        </span>
      </div>
      <span
        className="col-span-2 row-start-2 min-w-0 truncate font-mono text-[0.8rem] md:col-span-1 md:row-start-1 md:col-start-2"
        title={props.address}
      >
        {props.address}
      </span>
      <span className="col-start-2 row-start-1 md:col-start-3">
        <CopyButton label={props.label} value={props.address} size="icon-sm" />
      </span>
    </li>
  );
}
