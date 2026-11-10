import { facilitatorUrls } from "@herald/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyableCode } from "@/components/copyable-code";
import { CopyableValue } from "@/components/copyable-value";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  API_KEY_ENV_VAR,
  envFileSnippet,
  frameworkLabels,
  frameworks,
  integrationSnippet,
} from "@/lib/integration-snippets";

export const Route = createFileRoute("/_dashboard/integration")({
  head: () => ({ meta: [{ title: "Integration · Herald" }] }),
  component: Integration,
});

function Integration() {
  const { account, heraldEnv } = Route.useRouteContext();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">Integration</h1>
        <p className="text-muted-foreground">
          Keep your stock x402 server. Point its facilitator client at Herald with your API key, and
          build each route's Payment Options with <code>accepts()</code>. Buyers then pay from any
          chain Herald lists, with any stock x402 library.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Store your API key</CardTitle>
          <CardDescription>
            Create a key on the <Link to="/api-keys">API keys</Link> page and put it in your
            server's environment. Keep it out of your code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CopyableCode label=".env" code={envFileSnippet(heraldEnv)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add Herald to your server</CardTitle>
          <CardDescription>
            A Node.js server, filled in for {account.accountId} on Herald's {heraldEnv} facilitator.
            Change the route and the Price to suit your API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="hono">
            <TabsList>
              {frameworks.map((framework) => (
                <TabsTrigger key={framework} value={framework}>
                  {frameworkLabels[framework]}
                </TabsTrigger>
              ))}
            </TabsList>
            {frameworks.map((framework) => {
              const snippet = integrationSnippet({
                framework,
                providerAccount: account.accountId,
                env: heraldEnv,
              });
              return (
                <TabsContent key={framework} value={framework} className="flex flex-col gap-4">
                  <CopyableCode label="Terminal" code={snippet.install} />
                  <CopyableCode label="server.ts" code={snippet.code} />
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Herald's facilitator</CardTitle>
          <CardDescription>
            <code>facilitatorUrls.{heraldEnv}</code> in the snippet. Its <code>/supported</code> is
            public; <code>/verify</code> and <code>/settle</code> need the key in{" "}
            <code>{API_KEY_ENV_VAR}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CopyableValue label="Facilitator URL" value={facilitatorUrls[heraldEnv]} />
        </CardContent>
      </Card>
    </div>
  );
}
