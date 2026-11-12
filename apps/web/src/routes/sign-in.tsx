import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircleIcon,
  BanknoteArrowUpIcon,
  BotIcon,
  ShieldCheckIcon,
  WalletIcon,
} from "lucide-react";
import { useState } from "react";
import { HeraldLogo } from "@/components/brand/herald-logo";
import { EnvironmentBadge } from "@/components/layout/environment-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { base64ToBytes, nearConnector } from "@/lib/near-wallet";
import { inPlainWords } from "@/lib/plain-words";
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
  connecting: "Connecting your wallet…",
  signing: "Sign the message in your wallet…",
  verifying: "Checking your signature…",
};

const promises = [
  {
    icon: BotIcon,
    title: "Paid on every call",
    text: "Each request carries its own payment through x402, so any agent can pay without an account.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Your money stays yours",
    text: "Payments land in addresses your NEAR account controls. Herald never holds your funds or keys.",
  },
  {
    icon: BanknoteArrowUpIcon,
    title: "Withdraw anywhere",
    text: "To any wallet, another network or NEAR Intents. Herald pays the network fees.",
  },
];

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
      setError(
        cause instanceof Error ? inPlainWords(cause.message) : "Sign-in didn't finish. Try again.",
      );
      setStep("idle");
    }
  }

  const busy = step !== "idle";

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="hidden border-r bg-muted/50 lg:flex lg:flex-col lg:justify-between lg:gap-12 lg:p-12 xl:p-16">
        <HeraldLogo className="h-6 self-start" />
        <div className="flex max-w-xl flex-col gap-5">
          <h1 className="text-5xl leading-[1.05] font-semibold text-balance xl:text-6xl">
            Get paid by AI agents, one request at a time.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            Agents pay your API in stablecoins with every call, from whichever network they hold
            funds on. No sign-ups or invoices: the payment travels with the request, and Herald
            settles it before your API answers.
          </p>
        </div>
        <ul className="grid max-w-xl grid-cols-2 gap-x-10 gap-y-8">
          {promises.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-2">
              <Icon aria-hidden className="size-5 text-primary" />
              <span className="font-medium">{title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="flex w-full max-w-md flex-col gap-8">
          <HeraldLogo className="h-6 self-start lg:hidden" />
          <Card className="w-full">
            <CardHeader>
              <div className="mb-2">
                <EnvironmentBadge heraldEnv={heraldEnv} />
              </div>
              <CardTitle className="text-2xl">Sign in</CardTitle>
              <CardDescription>
                Connect the NEAR wallet your agent payments go to, then sign a short message to
                prove it's yours. Signing is free and sends nothing.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                First time here? Herald sets up your payment addresses when you sign in.
                {heraldEnv === "testnet" ? " In Test mode, use a .testnet account." : ""}
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
              <Button size="lg" className="w-full" disabled={busy} onClick={handleSignIn}>
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <WalletIcon data-icon="inline-start" />
                )}
                {busy ? stepLabels[step] : "Connect NEAR wallet"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>
    </main>
  );
}
