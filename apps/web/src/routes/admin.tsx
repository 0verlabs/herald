import { Await, createFileRoute } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { FeeWalletTable } from "@/components/admin/fee-wallets";
import { MinimumTable } from "@/components/admin/withdrawal-minimums";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { environmentLabels } from "@/lib/environment";
import { getAdminAccount, getGasWalletStatuses, getSweepMinimums } from "@/server/admin";
import { getHeraldEnv } from "@/server/herald-env";

// For Herald admins only (the HERALD_ADMINS allowlist). Anyone else, signed
// in or not, gets the 404 page, and the server functions behind it answer
// 404 too (`requireAdmin`).
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    // `getAdminAccount` answers 404 to anyone but an admin, which shows the
    // not-found page here; any other failure stays an error.
    const [account, heraldEnv] = await Promise.all([getAdminAccount(), getHeraldEnv()]);
    return { account: { ...account, isAdmin: true }, heraldEnv };
  },
  // Fee wallet balances come from each network's RPC, so they stream in
  // after the page renders. A failed call as a whole shows as unavailable.
  loader: async () => ({
    minimums: await getSweepMinimums(),
    gasWallets: getGasWalletStatuses().catch(() => null),
  }),
  head: () => ({ meta: [{ title: "Admin · Herald" }] }),
  component: Admin,
});

function Admin() {
  const { account, heraldEnv } = Route.useRouteContext();
  const { minimums, gasWallets } = Route.useLoaderData();

  return (
    <AppShell account={account} heraldEnv={heraldEnv}>
      <PageHeader
        title="Admin"
        description={`Herald's own wallets that pay network fees for every payment and withdrawal in ${environmentLabels[heraldEnv]}, and the smallest withdrawal on each network.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Fee wallets</CardTitle>
          <CardDescription>
            Each network's own coin, read live. Top a wallet up before it runs dry: payments and
            withdrawals on that network stop without it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Await promise={gasWallets} fallback={<FeeWalletTable wallets={null} />}>
            {(loaded) =>
              loaded ? (
                <FeeWalletTable wallets={loaded} />
              ) : (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Fee wallets unavailable</AlertTitle>
                  <AlertDescription>
                    Herald couldn't read its fee wallets. Reload the page to try again.
                  </AlertDescription>
                </Alert>
              )
            }
          </Await>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Smallest withdrawals</CardTitle>
          <CardDescription>
            Herald refuses a withdrawal below its network's minimum, so fees and the bridge's
            minimum never eat it. A change applies to the next withdrawal prepared.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MinimumTable minimums={minimums} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
