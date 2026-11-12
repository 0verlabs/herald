import type { SweepEntry } from "@herald/core/server";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, ArrowDownUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { WithdrawEverything } from "@/components/withdraw/withdraw-everything";
import { WithdrawFromNetwork } from "@/components/withdraw/withdraw-form";
import { WithdrawLayout } from "@/components/withdraw/withdraw-layout";
import { ALL_NETWORKS, WithdrawPicker } from "@/components/withdraw/withdraw-picker";
import { inFlight } from "@/components/withdraw/withdraw-shared";
import { WithdrawalHistory } from "@/components/withdraw/withdrawal-history";
import { getSweepChoices, listSweeps } from "@/server/sweeps";

// Withdrawals are Sweeps in Herald's own terms (see GLOSSARY.md); the page
// speaks the customer's words.
export const Route = createFileRoute("/_dashboard/withdraw")({
  loader: async () => {
    const [choices, sweeps] = await Promise.all([getSweepChoices(), listSweeps()]);
    return { choices, sweeps };
  },
  head: () => ({ meta: [{ title: "Withdraw · Herald" }] }),
  component: WithdrawPage,
});

// While a withdrawal waits on its approval, its receipt or the bridge, the
// history refreshes this often.
const POLL_MS = 3_000;

function WithdrawPage() {
  const { choices, sweeps: loadedSweeps } = Route.useLoaderData();
  const { account, heraldEnv } = Route.useRouteContext();
  const router = useRouter();
  const fetchSweeps = useServerFn(listSweeps);
  const [coin, setCoin] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  // The history as last polled, until the loader runs again.
  const [polled, setPolled] = useState<{ after: SweepEntry[]; sweeps: SweepEntry[] } | null>(null);
  const sweeps = polled?.after === loadedSweeps ? polled.sweeps : loadedSweeps;

  // Follow unfinished withdrawals; once one finishes, reload the balances too.
  const following = sweeps.filter(inFlight).length;
  useEffect(() => {
    if (following === 0) return;
    const timer = setInterval(async () => {
      const latest = await fetchSweeps().catch(() => null);
      if (!latest) return;
      setPolled({ after: loadedSweeps, sweeps: latest });
      if (latest.filter(inFlight).length < following) await router.invalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [following, fetchSweeps, router, loadedSweeps]);

  const capReached = choices.submittedToday >= choices.dailyCap;
  const chain = choices.chains.find((c) => c.network === network);
  const picker = (
    <WithdrawPicker
      chains={choices.chains}
      coin={coin}
      network={network}
      onCoin={setCoin}
      onNetwork={setNetwork}
    />
  );

  return (
    <>
      <PageHeader
        title="Withdraw"
        description="Send your stablecoins to any wallet, to another network, or into your NEAR Intents account."
      />

      <Card>
        <CardHeader>
          <CardTitle>New withdrawal</CardTitle>
          <CardDescription>
            Pick a coin and where it is, then where it goes. You approve in your NEAR wallet; Herald
            pays the network fees.
          </CardDescription>
          <CardAction>
            <Badge variant={capReached ? "destructive" : "outline"} className="amount">
              {choices.submittedToday} of {choices.dailyCap} today
            </Badge>
          </CardAction>
        </CardHeader>
        {capReached ? (
          <CardContent>
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Daily limit reached</AlertTitle>
              <AlertDescription>
                You can make up to {choices.dailyCap} withdrawals in 24 hours. Try again later.
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
        {coin && network === ALL_NETWORKS ? (
          <WithdrawEverything
            picker={picker}
            chains={choices.chains}
            accountId={account.accountId}
            heraldEnv={heraldEnv}
            dailyCap={choices.dailyCap}
            submittedToday={choices.submittedToday}
          />
        ) : coin && chain ? (
          // A new source starts a fresh withdrawal.
          <WithdrawFromNetwork
            key={chain.network}
            picker={picker}
            chain={chain}
            chains={choices.chains}
            capReached={capReached}
            accountId={account.accountId}
            heraldEnv={heraldEnv}
          />
        ) : (
          <WithdrawLayout
            picker={picker}
            summary={
              <Empty className="h-full border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ArrowDownUpIcon />
                  </EmptyMedia>
                  <EmptyTitle>{coin ? "Now pick a network" : "Start with a coin"}</EmptyTitle>
                  <EmptyDescription>
                    {coin
                      ? "Choose one network, or all of them to withdraw everything at once."
                      : "Choose the stablecoin you want to withdraw."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Withdrawal history</CardTitle>
          <CardDescription>Your latest withdrawals, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <WithdrawalHistory sweeps={sweeps} />
        </CardContent>
      </Card>
    </>
  );
}
