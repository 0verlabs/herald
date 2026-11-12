import { apiKeyPrefixes } from "@herald/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import { CreateKeyButton, KeyTable } from "@/components/developers/api-keys";
import { PageHeader } from "@/components/layout/page-header";
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { environmentLabels } from "@/lib/environment";
import { getApiKeys } from "@/server/api-keys";

export const Route = createFileRoute("/_dashboard/api-keys")({
  loader: () => getApiKeys(),
  head: () => ({ meta: [{ title: "API keys · Herald" }] }),
  component: ApiKeys,
});

function ApiKeys() {
  const keys = Route.useLoaderData();
  const { heraldEnv } = Route.useRouteContext();
  const prefix = apiKeyPrefixes[heraldEnv];

  return (
    <>
      <PageHeader
        title="API keys"
        description={
          <>
            Your server sends a key to Herald each time it checks a payment. Keys made here start
            with <code>{prefix}</code> and work in {environmentLabels[heraldEnv]} only.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>
            Use one key per service, so you can revoke one without touching the others.
          </CardDescription>
          {keys.length > 0 ? (
            <CardAction>
              <CreateKeyButton />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {keys.length > 0 ? (
            <KeyTable keys={keys} />
          ) : (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No API keys yet</EmptyTitle>
                <EmptyDescription>
                  Create a key, then follow the <Link to="/integration">setup steps</Link> to take
                  your first payment.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <CreateKeyButton />
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  );
}
