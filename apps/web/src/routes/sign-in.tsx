import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { base64ToBytes, nearConnector } from "@/lib/near-wallet";
import { getSessionAccount, getSignInChallenge, signInWithSignature } from "@/server/auth";
import { getHeraldEnv } from "@/server/herald-env";

/**
 * The path to return to after sign-in, if it stays on the dashboard. It is
 * parsed the way a browser would (which drops tabs and newlines and reads
 * `\` as `/`), so `//host`, `/\host` and `/%09/host` are all refused.
 */
function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  const base = "https://dashboard.invalid";
  const url = new URL(value, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = safeRedirect(search["redirect"]);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async ({ search }) => {
    if (await getSessionAccount()) throw redirect({ href: search.redirect ?? "/overview" });
  },
  loader: () => getHeraldEnv(),
  head: () => ({ meta: [{ title: "Sign in · Herald" }] }),
  component: SignIn,
});

type Step = "idle" | "connecting" | "signing" | "verifying";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  connecting: "Connecting wallet…",
  signing: "Waiting for your signature…",
  verifying: "Checking signature…",
};

function SignIn() {
  const heraldEnv = Route.useLoaderData();
  const search = Route.useSearch();
  const router = useRouter();
  const fetchChallenge = useServerFn(getSignInChallenge);
  const submitSignature = useServerFn(signInWithSignature);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    try {
      setStep("connecting");
      const connector = await nearConnector(heraldEnv);
      const wallet = await connector.connect();

      setStep("signing");
      const challenge = await fetchChallenge();
      if (!challenge.ok) throw new Error(challenge.message);
      const signed = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: base64ToBytes(challenge.nonce),
        network: heraldEnv,
      });

      setStep("verifying");
      const result = await submitSignature({
        data: {
          accountId: signed.accountId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          nonce: challenge.nonce,
        },
      });
      if (!result.ok) throw new Error(result.message);
      await router.navigate({ href: search.redirect ?? "/overview" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in didn't finish. Try again.");
      setStep("idle");
    }
  }

  const busy = step !== "idle";

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to Herald</CardTitle>
          <CardDescription>
            Connect the NEAR account you receive payments with, your Provider Account, and sign a
            message to prove you control it. Signing sends no transaction and costs nothing.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{heraldEnv}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground">
            The first time you sign in, Herald registers your Provider Account and derives your
            Receiving Addresses.
            {heraldEnv === "testnet" ? " Use a .testnet account." : ""}
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Couldn't sign in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button className="w-full" disabled={busy} onClick={handleSignIn}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? stepLabels[step] : "Connect NEAR wallet"}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
