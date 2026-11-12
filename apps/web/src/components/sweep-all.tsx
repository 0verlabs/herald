import {
  EvmAddressSchema,
  SolanaAddressSchema,
  type HeraldEnv,
  type SweepDestinationKind,
} from "@herald/core";
import type { SweepChainOption } from "@herald/core/server";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, LayersIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatUsdc, shortenMiddle } from "@/lib/format";
import { signEachInOwnTransaction, walletFor } from "@/lib/near-wallet";
import { discardPlannedSweep, finishSweep, startSweepAll } from "@/server/sweeps";

type Step = "idle" | "planning" | "quoting" | "signing" | "submitting";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  planning: "Planning the Sweeps…",
  quoting: "Asking 1Click for quotes…",
  signing: "Waiting for your wallet…",
  submitting: "Reading the signatures…",
};

const destinationKinds = [
  { kind: "same_chain", label: "Same chain" },
  { kind: "cross_chain", label: "One chain" },
  { kind: "intents", label: "NEAR Intents" },
] as const satisfies { kind: SweepDestinationKind; label: string }[];

type Planned = Extract<Awaited<ReturnType<typeof startSweepAll>>, { ok: true }>;

/** How one chain's Sweep went, for the summary after signing. */
type Outcome = { label: string; ok: boolean; message: string };

/** Why `address` isn't one to Sweep to on a chain of this kind, or null if it is. */
function addressProblem(address: string, kind: SweepChainOption["kind"]): string | null {
  if (kind === "evm") {
    return EvmAddressSchema.safeParse(address).success
      ? null
      : "Enter an EVM address: 0x and 40 hex characters.";
  }
  return SolanaAddressSchema.safeParse(address).success ? null : "Enter a Solana wallet address.";
}

/**
 * "Sweep all": the whole balance of every chain holding at least its
 * minimum, one Sweep per chain. The wallet sends one NEAR transaction per
 * Sweep, in one request where it can, and each Sweep is followed on its own.
 */
export function SweepAllCard(props: {
  chains: SweepChainOption[];
  heraldEnv: HeraldEnv;
  accountId: string;
  submittedToday: number;
  dailyCap: number;
}) {
  const router = useRouter();
  const plan = useServerFn(startSweepAll);
  const finish = useServerFn(finishSweep);
  const discard = useServerFn(discardPlannedSweep);
  const [kind, setKind] = useState<SweepDestinationKind>("same_chain");
  const [evmDestination, setEvmDestination] = useState("");
  const [solanaDestination, setSolanaDestination] = useState("");
  const [destinationNetwork, setDestinationNetwork] = useState("");
  const [destination, setDestination] = useState("");
  const [quoted, setQuoted] = useState<Planned | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!quoted) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quoted]);

  const chains = props.chains.filter((chain) => chain.sweepAll);
  const labelOf = (network: string) =>
    props.chains.find((c) => c.network === network)?.label ?? network;
  const oneClickAvailable = props.chains.some((c) => c.oneClick);
  const destinationChains = props.chains.filter((c) => c.oneClick);
  const destinationChain =
    destinationChains.find((c) => c.network === destinationNetwork) ?? destinationChains[0];
  const hasEvm = chains.some((c) => c.kind === "evm");
  const hasSolana = chains.some((c) => c.kind === "solana");
  const room = Math.max(props.dailyCap - props.submittedToday, 0);

  const evm = evmDestination.trim();
  const sol = solanaDestination.trim();
  const crossAddress = destination.trim();
  const evmProblem = evm && hasEvm ? addressProblem(evm, "evm") : null;
  const solanaProblem = sol && hasSolana ? addressProblem(sol, "solana") : null;
  const crossProblem =
    crossAddress && destinationChain ? addressProblem(crossAddress, destinationChain.kind) : null;
  const busy = step !== "idle";
  const viaOneClick = kind !== "same_chain";
  const ready =
    !busy &&
    chains.length > 0 &&
    room > 0 &&
    (kind === "same_chain"
      ? ((hasEvm && evm !== "") || (hasSolana && sol !== "")) && !evmProblem && !solanaProblem
      : kind === "cross_chain"
        ? oneClickAvailable &&
          destinationChain !== undefined &&
          crossAddress !== "" &&
          !crossProblem
        : oneClickAvailable);
  const signBy = quoted
    ? Math.min(...quoted.planned.map((p) => p.quote?.signBy.getTime() ?? Infinity))
    : Infinity;
  const secondsLeft = (signBy - now) / 1000;
  const quotesExpired = quoted !== null && secondsLeft <= 0;

  function dropQuotes() {
    if (!quoted) return;
    // Best effort: unsigned Sweeps expire on their own anyway.
    for (const { sweepId } of quoted.planned) {
      void discard({ data: { sweepId } }).catch(() => undefined);
    }
    setQuoted(null);
  }

  function edit(change: () => void) {
    change();
    dropQuotes();
    setOutcomes(null);
  }

  async function requestPlan(): Promise<Planned> {
    const planned = await plan({
      data:
        kind === "same_chain"
          ? {
              destinationKind: "same_chain",
              ...(hasEvm && evm ? { evmDestination: evm } : {}),
              ...(hasSolana && sol ? { solanaDestination: sol } : {}),
            }
          : kind === "cross_chain"
            ? {
                destinationKind: "cross_chain",
                destinationNetwork: destinationChain?.network ?? "",
                destination: crossAddress,
              }
            : { destinationKind: "intents" },
    });
    if (!planned.ok) throw new Error(planned.message);
    if (planned.planned.length === 0) {
      throw new Error(
        planned.skipped.map((s) => `${s.label}: ${s.message}`).join(" ") ||
          "There's nothing to Sweep.",
      );
    }
    return planned;
  }

  /** Signs every planned Sweep, then hands each NEAR transaction to Herald. */
  async function signAll(planned: Planned) {
    setStep("signing");
    const wallet = await walletFor(props.heraldEnv, props.accountId);
    const signed = await signEachInOwnTransaction(wallet, {
      heraldEnv: props.heraldEnv,
      signerId: props.accountId,
      requests: planned.planned.map(({ signRequest }) => signRequest),
    });
    const sentAny = signed.hashes.some((hash) => hash !== null);
    // Nothing went out: the Sweeps that certainly weren't sent can go, the
    // rest expire unsigned.
    if (signed.error && !sentAny) {
      planned.planned.forEach(({ sweepId }, index) => {
        if (signed.unsent[index]) void discard({ data: { sweepId } }).catch(() => undefined);
      });
      throw signed.error;
    }

    setStep("submitting");
    const finished = await Promise.all(
      planned.planned.map(async ({ sweepId, network, amount }, index): Promise<Outcome> => {
        const label = labelOf(network);
        const nearTxHash = signed.hashes[index];
        if (!nearTxHash) {
          if (signed.unsent[index]) void discard({ data: { sweepId } }).catch(() => undefined);
          return {
            label,
            ok: false,
            message: signed.unsent[index]
              ? "Not signed: your wallet stopped before it."
              : "Your wallet didn't return its NEAR transaction. If it went out, the list below picks it up.",
          };
        }
        try {
          const result = await finish({ data: { sweepId, nearTxHash } });
          if (!result.ok) return { label, ok: false, message: result.message };
          if (result.status === "failed") {
            return { label, ok: false, message: result.error ?? "The Sweep failed." };
          }
          return {
            label,
            ok: true,
            message:
              result.status === "awaiting_signature"
                ? `${formatUsdc(amount)} USDC: the MPC network is still signing.`
                : `${formatUsdc(amount)} USDC: Herald submitted the transfer.`,
          };
        } catch {
          // The Sweep keeps its NEAR transaction; the list picks it up.
          return { label, ok: true, message: "Signed. Follow it in the list below." };
        }
      }),
    );
    const skipped = planned.skipped.map(({ label, message }) => ({ label, ok: false, message }));
    setOutcomes([...finished, ...skipped]);
  }

  async function run(first: Step, action: () => Promise<void>) {
    setError(null);
    setOutcomes(null);
    try {
      setStep(first);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Sweeps didn't go through. Try again.");
    } finally {
      setStep("idle");
      await router.invalidate();
    }
  }

  const handleSweepAll = () =>
    run("planning", async () => {
      await signAll(await requestPlan());
    });

  const handleQuote = () =>
    run("quoting", async () => {
      dropQuotes();
      const planned = await requestPlan();
      setNow(Date.now());
      setQuoted(planned);
    });

  const handleSignQuotes = () => {
    if (!quoted || quotesExpired) return;
    const planned = quoted;
    return run("signing", async () => {
      setQuoted(null);
      await signAll(planned);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sweep all</CardTitle>
        <CardDescription>
          The whole balance of every chain holding at least its minimum, one Sweep per chain. Your
          wallet approves them in one request where it can, otherwise once per chain.
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {chains.length} {chains.length === 1 ? "chain" : "chains"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {chains.length === 0 ? (
          <p className="text-muted-foreground">No chain holds at least its minimum Sweep yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 rounded-lg border p-4">
            {chains.map((chain) => (
              <li key={chain.network} className="flex justify-between gap-4">
                <span>{chain.label}</span>
                <span className="font-mono">
                  {chain.balance.ok ? formatUsdc(chain.balance.amount) : "?"} USDC
                </span>
              </li>
            ))}
          </ul>
        )}
        {chains.length > room ? (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>Not every chain fits today</AlertTitle>
            <AlertDescription>
              Herald submits at most {props.dailyCap} Sweeps per Provider in 24 hours, and {room}{" "}
              {room === 1 ? "is" : "are"} left. The rest wait for the next window.
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field>
            <FieldLabel>To</FieldLabel>
            <ToggleGroup
              value={[kind]}
              onValueChange={(value) => {
                const next = destinationKinds.find((d) => d.kind === value[0]);
                if (next) edit(() => setKind(next.kind));
              }}
              variant="outline"
              disabled={busy}
            >
              {destinationKinds.map((option) => (
                <ToggleGroupItem
                  key={option.kind}
                  value={option.kind}
                  disabled={option.kind !== "same_chain" && !oneClickAvailable}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {kind === "same_chain"
                ? "Each chain Sweeps to an address on that chain. Leave an address empty to skip those chains."
                : kind === "cross_chain"
                  ? "Everything lands as USDC on one chain: that chain Sweeps on itself, the others go through 1Click."
                  : `Everything is credited to your NEAR Intents account, ${props.accountId}, through 1Click.`}
              {oneClickAvailable
                ? null
                : " Sweeping into one chain or NEAR Intents goes through 1Click, which runs on mainnet only."}
            </FieldDescription>
          </Field>

          {kind === "same_chain" && hasEvm ? (
            <Field data-invalid={evmProblem ? true : undefined}>
              <FieldLabel htmlFor="sweep-all-evm">EVM destination</FieldLabel>
              <Input
                id="sweep-all-evm"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                className="font-mono"
                value={evmDestination}
                disabled={busy}
                onChange={(event) => edit(() => setEvmDestination(event.target.value))}
              />
              <FieldDescription>
                Used on{" "}
                {chains
                  .filter((c) => c.kind === "evm")
                  .map((c) => c.label)
                  .join(", ")}
                .
              </FieldDescription>
              <FieldError>{evmProblem}</FieldError>
            </Field>
          ) : null}
          {kind === "same_chain" && hasSolana ? (
            <Field data-invalid={solanaProblem ? true : undefined}>
              <FieldLabel htmlFor="sweep-all-solana">Solana destination</FieldLabel>
              <Input
                id="sweep-all-solana"
                autoComplete="off"
                spellCheck={false}
                placeholder="Solana wallet address"
                className="font-mono"
                value={solanaDestination}
                disabled={busy}
                onChange={(event) => edit(() => setSolanaDestination(event.target.value))}
              />
              <FieldDescription>
                A wallet address, not a token account. If it has no USDC account yet, Herald creates
                one.
              </FieldDescription>
              <FieldError>{solanaProblem}</FieldError>
            </Field>
          ) : null}
          {kind === "cross_chain" && destinationChains.length > 0 ? (
            <>
              <Field>
                <FieldLabel>Destination chain</FieldLabel>
                <ToggleGroup
                  value={destinationChain ? [destinationChain.network] : []}
                  onValueChange={(value) => {
                    const next = destinationChains.find((c) => c.network === value[0]);
                    if (!next) return;
                    edit(() => {
                      if (next.kind !== destinationChain?.kind) setDestination("");
                      setDestinationNetwork(next.network);
                    });
                  }}
                  variant="outline"
                  disabled={busy}
                >
                  {destinationChains.map((option) => (
                    <ToggleGroupItem key={option.network} value={option.network}>
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field data-invalid={crossProblem ? true : undefined}>
                <FieldLabel htmlFor="sweep-all-destination">Destination address</FieldLabel>
                <Input
                  id="sweep-all-destination"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    destinationChain?.kind === "solana" ? "Solana wallet address" : "0x…"
                  }
                  className="font-mono"
                  value={destination}
                  disabled={busy}
                  onChange={(event) => edit(() => setDestination(event.target.value))}
                />
                <FieldError>{crossProblem}</FieldError>
              </Field>
            </>
          ) : null}
        </FieldGroup>

        {quoted ? (
          <QuotesReview
            planned={quoted}
            labelOf={labelOf}
            secondsLeft={secondsLeft}
            expired={quotesExpired}
          />
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The Sweeps didn't go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {outcomes ? (
          <Alert>
            <LayersIcon />
            <AlertTitle>Sweeps started</AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-1">
                {outcomes.map((outcome) => (
                  <li key={outcome.label} className={outcome.ok ? undefined : "text-destructive"}>
                    {outcome.label}: {outcome.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex gap-2">
        {!viaOneClick ? (
          <Button className="w-full" disabled={!ready} onClick={handleSweepAll}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? stepLabels[step] : "Sweep all with NEAR wallet"}
          </Button>
        ) : quoted && !quotesExpired ? (
          <>
            <Button variant="outline" disabled={busy} onClick={dropQuotes}>
              Discard quotes
            </Button>
            <Button className="flex-1" disabled={busy} onClick={handleSignQuotes}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? stepLabels[step] : `Sign ${quoted.planned.length} with NEAR wallet`}
            </Button>
          </>
        ) : (
          <Button className="w-full" disabled={!ready} onClick={handleQuote}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? stepLabels[step] : quotesExpired ? "Get fresh quotes" : "Get 1Click quotes"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** The planned Sweeps and their 1Click quotes, for the Provider to check before signing. */
function QuotesReview(props: {
  planned: Planned;
  labelOf: (network: string) => string;
  secondsLeft: number;
  expired: boolean;
}) {
  const whole = Math.max(0, Math.floor(props.secondsLeft));
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      {props.planned.planned.map(({ sweepId, network, amount, quote }) => (
        <div key={sweepId} className="flex flex-wrap justify-between gap-x-4">
          <span>{props.labelOf(network)}</span>
          <span className="font-mono">
            {formatUsdc(amount)} USDC
            {quote
              ? ` → ${formatUsdc(quote.amountOut)} (fee ${formatUsdc(quote.fee)}, deposit ${shortenMiddle(quote.depositAddress, 6, 4)})`
              : " → same chain, no fee"}
          </span>
        </div>
      ))}
      {props.planned.skipped.map((s) => (
        <div key={s.network} className="text-muted-foreground">
          {s.label}: {s.message}
        </div>
      ))}
      <p className="text-muted-foreground">
        {props.expired
          ? "These quotes expired. Get fresh ones to Sweep."
          : Number.isFinite(props.secondsLeft)
            ? `Sign within ${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}. If 1Click fails, it refunds each Receiving Address.`
            : "Sign right away."}
      </p>
    </div>
  );
}
