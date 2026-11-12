import { networkRegistry, type NetworkKind } from "@herald/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CreateKeyButton } from "@/components/developers/api-keys";
import { SetupStep } from "@/components/developers/setup-step";
import { PageHeader } from "@/components/layout/page-header";
import { CoinLogo } from "@/components/money/coin-logo";
import { NetworkLogo } from "@/components/money/network-logo";
import { CodeBlock } from "@/components/shared/code-block";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { environmentLabels } from "@/lib/environment";
import {
  envFileSnippet,
  frameworkLabels,
  integrationSnippet,
  runtimes,
  type Runtime,
} from "@/lib/integration-snippets";
import { USDC } from "@/lib/stablecoins";

export const Route = createFileRoute("/_dashboard/integration")({
  head: () => ({ meta: [{ title: "Connect your API · Herald" }] }),
  component: Integration,
});

const kindLabels = { evm: "EVM", solana: "Solana" } as const satisfies Record<NetworkKind, string>;

const runtimeOptions = Object.entries(runtimes) as [Runtime, (typeof runtimes)[Runtime]][];

function Integration() {
  const { account, heraldEnv } = Route.useRouteContext();
  const [runtime, setRuntime] = useState<Runtime>("node");
  const networks = networkRegistry[heraldEnv];

  return (
    <>
      <PageHeader
        title="Connect your API"
        description="Charge for your API one request at a time. Once it's connected, a paid route asks the caller for a small stablecoin payment before it answers, and the money lands in your payment addresses."
      />

      <ol className="flex flex-col">
        <SetupStep
          number={1}
          title="Store your API key"
          description={
            <>
              Your server sends this key to Herald with every payment. Keep it in your server's
              environment, never in your code. You can manage keys on the{" "}
              <Link to="/api-keys">API keys</Link> page.
            </>
          }
        >
          <CodeBlock label=".env" language="dotenv" code={envFileSnippet(heraldEnv)} />
          <CreateKeyButton align="start" showSetupLink={false} />
        </SetupStep>

        <SetupStep
          number={2}
          title="Add Herald to your server"
          description={
            <>
              Filled in for {account.accountId} in {environmentLabels[heraldEnv]}. Change the route
              and the price to suit your API.
            </>
          }
        >
          <FieldGroup>
            <Field>
              <FieldLabel>Language</FieldLabel>
              <ToggleGroup
                value={[runtime]}
                onValueChange={(value) => {
                  const next = runtimeOptions.find(([key]) => key === value[0]);
                  if (next) setRuntime(next[0]);
                }}
                variant="outline"
              >
                {runtimeOptions.map(([key, option]) => (
                  <ToggleGroupItem key={key} value={key} className="px-3">
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          </FieldGroup>
          <Tabs key={runtime} defaultValue={runtimes[runtime].frameworks[0]} className="gap-4">
            <TabsList>
              {runtimes[runtime].frameworks.map((framework) => (
                <TabsTrigger key={framework} value={framework} className="px-3">
                  {frameworkLabels[framework]}
                </TabsTrigger>
              ))}
            </TabsList>
            {runtimes[runtime].frameworks.map((framework) => {
              const snippet = integrationSnippet({
                framework,
                providerAccount: account.accountId,
                env: heraldEnv,
              });
              return (
                <TabsContent key={framework} value={framework} className="flex flex-col gap-4">
                  <CodeBlock label="Terminal" language="bash" code={snippet.install} />
                  <CodeBlock
                    label="server.ts"
                    language="typescript"
                    code={snippet.code}
                    lineNumbers
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        </SetupStep>

        <SetupStep
          number={3}
          title="Supported payment networks"
          description={`Your API accepts payments on every one of these in ${environmentLabels[heraldEnv]}.`}
          last
        >
          <ul className="flex flex-col divide-y rounded-xl border">
            {networks.map((network) => (
              <li
                key={network.caip2}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
              >
                <NetworkLogo label={network.label} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{network.label}</span>
                  <span className="text-xs text-muted-foreground">{kindLabels[network.kind]}</span>
                </span>
                <Badge variant="outline" className="h-6 gap-1.5 pl-1">
                  <CoinLogo symbol={USDC.symbol} size="sm" className="size-4 text-[0.5rem]" />
                  {USDC.symbol}
                </Badge>
              </li>
            ))}
          </ul>
        </SetupStep>
      </ol>
    </>
  );
}
