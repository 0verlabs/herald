import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PRIVY_APP_ID, PRIVY_AUTH_ORIGIN } from "@hrld/core";
import { Button } from "@hrld/ui/components/button";

export const Route = createFileRoute("/auth/verify")({
  validateSearch: (search) => ({
    user_code: typeof search.user_code === "string" ? search.user_code : "",
  }),
  component: AuthorizeRoute,
});

function AuthorizeRoute() {
  return (
    <ClientOnly fallback={null}>
      <PrivyProvider appId={PRIVY_APP_ID}>
        <AuthorizePage />
      </PrivyProvider>
    </ClientOnly>
  );
}

type Result = "approved" | "denied" | "error";

function AuthorizePage() {
  const privy = usePrivy();
  const search = Route.useSearch();
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(action: "approve" | "deny") {
    setSubmitting(true);

    const accessToken = await privy.getAccessToken().catch(() => null);
    const res = accessToken
      ? await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/device_verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "privy-app-id": PRIVY_APP_ID,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ user_code: search.user_code, action }),
        }).catch(() => null)
      : null;

    setSubmitting(false);
    if (!res?.ok) return setResult("error");
    setResult(action === "approve" ? "approved" : "denied");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6">
      <div className="w-full rounded-xl border border-border bg-card p-8 shadow-2xl shadow-black/10">
        <p className="mb-5 font-mono text-xs tracking-[0.22em] text-muted-foreground uppercase">
          Device authorization
        </p>
        <AuthorizeContent
          privy={privy}
          result={result}
          submit={submit}
          submitting={submitting}
          userCode={search.user_code}
        />
      </div>
    </main>
  );
}

function AuthorizeContent(props: {
  privy: ReturnType<typeof usePrivy>;
  result: Result | null;
  submit: (action: "approve" | "deny") => Promise<void>;
  submitting: boolean;
  userCode: string;
}) {
  if (!props.userCode)
    return (
      <p className="text-sm text-muted-foreground">
        No code found. Open the link shown by the Herald CLI, or restart the login with{" "}
        <code className="font-mono">hrld auth login</code>.
      </p>
    );

  if (props.result === "approved")
    return (
      <p className="text-sm">Access approved. You can close this tab and return to the CLI.</p>
    );

  if (props.result === "denied")
    return <p className="text-sm">Access denied. You can close this tab.</p>;

  if (props.result === "error")
    return (
      <p className="text-sm text-destructive">
        Something went wrong. The code may be invalid or expired — restart the login with{" "}
        <code className="font-mono">hrld auth login</code>.
      </p>
    );

  if (!props.privy.ready) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <>
      <h1 className="font-serif text-2xl font-medium tracking-tight">Authorize the Herald CLI</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        A command line on another device is asking for access to your Herald account. Only continue
        if the code below matches the one shown in your terminal.
      </p>
      <p className="my-6 text-center font-mono text-3xl font-semibold tracking-widest">
        {props.userCode}
      </p>
      {!props.privy.authenticated ? (
        <Button className="w-full" onClick={() => props.privy.login()} size="lg">
          Log in to continue
        </Button>
      ) : (
        <>
          <div className="flex gap-3">
            <Button
              className="flex-1"
              disabled={props.submitting}
              onClick={() => props.submit("approve")}
              size="lg"
            >
              Approve
            </Button>
            <Button
              className="flex-1"
              disabled={props.submitting}
              onClick={() => props.submit("deny")}
              size="lg"
              variant="outline"
            >
              Deny
            </Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Approving as <span className="font-mono">{accountLabel(props.privy)}</span> ·{" "}
            <button
              className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              disabled={props.submitting}
              onClick={() => props.privy.logout()}
              type="button"
            >
              Switch account
            </button>
          </p>
        </>
      )}
    </>
  );
}

function accountLabel(privy: ReturnType<typeof usePrivy>): string {
  const address = privy.user?.wallet?.address;
  if (address) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return privy.user?.email?.address ?? privy.user?.phone?.number ?? "unknown account";
}
