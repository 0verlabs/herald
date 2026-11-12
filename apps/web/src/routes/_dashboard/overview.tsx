import type { ChainBalance } from "@herald/core/server";
import { Await, createFileRoute } from "@tanstack/react-router";
import { BalanceCard } from "@/components/home/balance-card";
import { EarningsCard } from "@/components/home/earnings-card";
import { PaymentAddressesCard } from "@/components/home/payment-addresses-card";
import { PageHeader } from "@/components/layout/page-header";
import { holdingOf, USDC, type NetworkHolding } from "@/lib/stablecoins";
import { getBalances, getOverview } from "@/server/overview";

export const Route = createFileRoute("/_dashboard/overview")({
  // Balances come from each network's RPC, so they stream in after the page
  // renders instead of holding it up. Failing networks already come back one
  // by one; a failed call as a whole (say, the Worker unreachable) shows as
  // "Balances unavailable" rather than taking down the page.
  loader: async () => ({
    overview: await getOverview(),
    balances: getBalances().catch(() => null),
  }),
  head: () => ({ meta: [{ title: "Home · Herald" }] }),
  component: Home,
});

/** A network's USDC balance as the stablecoin list shows it. */
function holdingFromBalance(balance: ChainBalance): NetworkHolding {
  const base = { network: balance.network, label: balance.label, address: balance.address };
  return balance.ok
    ? { ...base, amount: balance.amount }
    : { ...base, amount: null, problem: balance.message };
}

function Home() {
  const { overview, balances } = Route.useLoaderData();
  const { revenue } = overview;
  // While balances load, every network shows as loading.
  const loadingHoldings = [
    holdingOf(
      USDC,
      revenue.chains.map((chain) => ({ network: chain.network, label: chain.label, amount: null })),
    ),
  ];

  return (
    <>
      <PageHeader
        title="Home"
        description="Your customers pay in stablecoins on whichever network they like. Herald gathers it all here, so you see one balance and withdraw when you want."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Await promise={balances} fallback={<BalanceCard holdings={loadingHoldings} />}>
          {(loaded) => (
            <BalanceCard
              holdings={loaded ? [holdingOf(USDC, loaded.map(holdingFromBalance))] : null}
            />
          )}
        </Await>
        <EarningsCard revenue={revenue} />
      </div>
      <PaymentAddressesCard overview={overview} />
    </>
  );
}
