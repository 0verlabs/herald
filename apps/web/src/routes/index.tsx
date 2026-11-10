import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getNetwork } from "@/server/network";

export const Route = createFileRoute("/")({
  loader: () => getNetwork(),
  component: Home,
});

function Home() {
  const network = Route.useLoaderData();

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Herald</CardTitle>
          <CardDescription>
            Accept x402 payments on many chains into addresses controlled by one NEAR account.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{network}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            The Provider dashboard is under construction. Sign-in, Receiving Addresses and API keys
            arrive here next.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
