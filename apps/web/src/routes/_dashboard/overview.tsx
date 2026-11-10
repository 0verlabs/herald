import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CopyableValue } from "@/components/copyable-value";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOverview } from "@/server/overview";

export const Route = createFileRoute("/_dashboard/overview")({
  loader: () => getOverview(),
  head: () => ({ meta: [{ title: "Overview · Herald" }] }),
  component: Overview,
});

function Overview() {
  const { accountId, evm, solana } = Route.useLoaderData();

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
