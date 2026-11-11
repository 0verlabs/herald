import {
  EvmAddressSchema,
  PriceSchema,
  priceToBaseUnits,
  SolanaAddressSchema,
  USDC_DECIMALS,
  type SweepDestinationKind,
  type SweepStatus,
} from "@herald/core";
import type { MpcSignRequest, SweepChainOption, SweepEntry, SweepQuote } from "@herald/core/server";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, ArrowRightLeftIcon, ExternalLinkIcon, TimerIcon } from "lucide-react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatUsdc, formatUtc, shortenMiddle } from "@/lib/format";
import { walletFor } from "@/lib/near-wallet";
import { cn } from "@/lib/utils";
import { finishSweep, getSweepChoices, listSweeps, startSweep } from "@/server/sweeps";

export const Route = createFileRoute("/_dashboard/sweep")({
  loader: async () => {
    const [choices, sweeps] = await Promise.all([getSweepChoices(), listSweeps()]);
    return { choices, sweeps };
  },
  head: () => ({ meta: [{ title: "Sweep · Herald" }] }),
  component: SweepPage,
});

// While a Sweep is waiting on its signature, its receipt or 1Click, the
// list refreshes this often.
const POLL_MS = 3_000;

const inFlight = (sweep: SweepEntry) =>
  sweep.status === "awaiting_signature" ||
  sweep.status === "submitted" ||
  sweep.status === "delivering" ||
  (sweep.status === "confirmed" && sweep.destinationKind !== "same_chain");

function SweepPage() {
  const { choices, sweeps: loadedSweeps } = Route.useLoaderData();
  const router = useRouter();
  const fetchSweeps = useServerFn(listSweeps);
  // The list as last polled, until the loader runs again.
  const [polled, setPolled] = useState<{ after: SweepEntry[]; sweeps: SweepEntry[] } | null>(null);
  const sweeps = polled?.after === loadedSweeps ? polled.sweeps : loadedSweeps;

  // Follow unfinished Sweeps; once one finishes, reload the balances too.
  const following = sweeps.filter(inFlight).length;
  useEffect(() => {
    if (following === 0) return;
    const timer = setInterval(async () => {
      const latest = await fetchSweeps().catch(() => null);
      if (!latest) return;
      setPolled({ after: loadedSweeps, sweeps: latest });
      if (latest.filter(inFlight).length < following) await router.invalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [following, fetchSweeps, router, loadedSweeps]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-medium">Sweep</h1>
        <p className="text-muted-foreground">
          Move USDC from a Receiving Address to any address on the same chain, to USDC on another
          chain, or into your NEAR Intents account. Your NEAR wallet signs once, through NEAR Chain
          Signatures, and Herald pays the gas.
        </p>
      </div>

      <SweepForm
        chains={choices.chains}
        capReached={choices.submittedToday >= choices.dailyCap}
        dailyCap={choices.dailyCap}
        submittedToday={choices.submittedToday}
      />

      <Card>
        <CardHeader>
          <CardTitle>Sweeps</CardTitle>
          <CardDescription>Your latest Sweeps, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {sweeps.length > 0 ? (
            <SweepTable sweeps={sweeps} />
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArrowRightLeftIcon />
                </EmptyMedia>
                <EmptyTitle>No Sweeps yet</EmptyTitle>
                <EmptyDescription>
                  Sweeps you start show up here with their status.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type Step = "idle" | "planning" | "quoting" | "signing" | "submitting";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  planning: "Planning the Sweep…",
  quoting: "Asking 1Click for a quote…",
  signing: "Waiting for your wallet…",
  submitting: "Reading the signature…",
};

const destinationKinds = [
  { kind: "same_chain", label: "Same chain" },
  { kind: "cross_chain", label: "Another chain" },
  { kind: "intents", label: "NEAR Intents" },
] as const satisfies { kind: SweepDestinationKind; label: string }[];

/** A planned 1Click Sweep waiting for the Provider to check its quote and sign. */
type QuotedSweep = { sweepId: number; signRequest: MpcSignRequest; quote: SweepQuote };

/**
 * A USDC amount the Provider typed (`"1.5"`) in base units, or null if it
 * isn't a positive amount with at most 6 decimals.
 */
function usdcToBaseUnits(amount: string): string | null {
  const parsed = PriceSchema.safeParse(amount.trim());
  return parsed.success ? priceToBaseUnits(parsed.data, USDC_DECIMALS) : null;
}

/** Base units as a plain decimal the amount field accepts: `"1500000"` is `"1.5"`. */
function baseUnitsToInput(baseUnits: string): string {
  return formatUsdc(baseUnits)
    .replaceAll(",", "")
    .replace(/\.?0+$/, "");
}

/** Why `address` isn't one to Sweep to on `chain`, or null if it is. */
function addressProblem(address: string, chain: SweepChainOption): string | null {
  if (chain.kind === "evm") {
    return EvmAddressSchema.safeParse(address).success
      ? null
      : "Enter an EVM address: 0x and 40 hex characters.";
  }
  return SolanaAddressSchema.safeParse(address).success ? null : "Enter a Solana wallet address.";
}

/** Seconds as `4:05`. */
function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function SweepForm(props: {
  chains: SweepChainOption[];
  capReached: boolean;
  dailyCap: number;
  submittedToday: number;
}) {
  const { account, heraldEnv } = Route.useRouteContext();
  const router = useRouter();
  const plan = useServerFn(startSweep);
  const finish = useServerFn(finishSweep);
  const [network, setNetwork] = useState(props.chains[0]?.network ?? "");
  const [kind, setKind] = useState<SweepDestinationKind>("same_chain");
  const [destinationNetwork, setDestinationNetwork] = useState("");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [quoted, setQuoted] = useState<QuotedSweep | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Count down the quote's signing window.
  useEffect(() => {
    if (!quoted) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quoted]);

  const chain = props.chains.find((c) => c.network === network);
  if (!chain) return null;
  const oneClickAvailable = props.chains.some((c) => c.oneClick);
  const viaOneClick = kind !== "same_chain";
  const destinationChains = props.chains.filter((c) => c.oneClick && c.network !== network);
  const destinationChain =
    destinationChains.find((c) => c.network === destinationNetwork) ?? destinationChains[0];
  // The chain the destination address is on: none for NEAR Intents.
  const addressChain =
    kind === "same_chain" ? chain : kind === "cross_chain" ? destinationChain : undefined;

  const balance = chain.balance.ok ? chain.balance.amount : null;
  const baseUnits = usdcToBaseUnits(amount);
  const amountProblem = !amount
    ? null
    : baseUnits === null
      ? "Enter a USDC amount, like 1.50."
      : chain.minimum !== null && BigInt(baseUnits) < BigInt(chain.minimum)
        ? `The minimum Sweep from ${chain.label} is ${formatUsdc(chain.minimum)} USDC.`
        : balance !== null && BigInt(baseUnits) > BigInt(balance)
          ? `Your Receiving Address holds ${formatUsdc(balance)} USDC on ${chain.label}.`
          : null;
  const trimmedDestination = destination.trim();
  // EVM addresses are case-insensitive; Solana's base58 ones aren't. A
  // Receiving Address on another chain is fine: that's consolidating.
  const isOwnAddress =
    kind === "same_chain" &&
    (chain.kind === "evm"
      ? trimmedDestination.toLowerCase() === chain.address.toLowerCase()
      : trimmedDestination === chain.address);
  const destinationProblem =
    !addressChain || !destination
      ? null
      : (addressProblem(trimmedDestination, addressChain) ??
        (isOwnAddress ? "That's your Receiving Address. Sweep to another address." : null));
  const kindProblem = !viaOneClick
    ? null
    : !oneClickAvailable
      ? "1Click runs on mainnet only, so cross-chain and NEAR Intents Sweeps work on Herald mainnet."
      : !chain.oneClick
        ? `1Click doesn't take USDC from ${chain.label}.`
        : kind === "cross_chain" && !destinationChain
          ? "There's no other chain 1Click delivers USDC to."
          : null;
  const busy = step !== "idle";
  const ready =
    !busy &&
    !props.capReached &&
    balance !== null &&
    chain.minimum !== null &&
    baseUnits !== null &&
    amountProblem === null &&
    kindProblem === null &&
    (addressChain === undefined || (destination !== "" && destinationProblem === null));
  const secondsLeft = quoted ? (quoted.quote.signBy.getTime() - now) / 1000 : 0;
  const quoteExpired = quoted !== null && secondsLeft <= 0;

  // Any change to the Sweep makes its quote stale.
  function edit(change: () => void) {
    change();
    setQuoted(null);
    setNotice(null);
  }

  async function requestPlan() {
    if (baseUnits === null) throw new Error("Enter a USDC amount, like 1.50.");
    const base = { network, amount: baseUnits };
    const planned = await plan({
      data:
        kind === "same_chain"
          ? { ...base, destinationKind: "same_chain", destination: trimmedDestination }
          : kind === "cross_chain"
            ? {
                ...base,
                destinationKind: "cross_chain",
                destinationNetwork: destinationChain?.network ?? "",
                destination: trimmedDestination,
              }
            : { ...base, destinationKind: "intents" },
    });
    if (!planned.ok) throw new Error(planned.message);
    return planned;
  }

  /** Has the Provider's wallet ask the MPC signer to sign, then hands the NEAR tx to Herald. */
  async function signAndFinish(sweepId: number, signRequest: MpcSignRequest) {
    setStep("signing");
    const wallet = await walletFor(heraldEnv, account.accountId);
    const outcome = await wallet.signAndSendTransaction({
      network: heraldEnv,
      signerId: account.accountId,
      receiverId: signRequest.contractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: signRequest.methodName,
            args: signRequest.args,
            gas: signRequest.gas,
            deposit: signRequest.deposit,
          },
        },
      ],
    });
    const nearTxHash: unknown = outcome.transaction_outcome?.id ?? outcome.transaction?.hash;
    if (typeof nearTxHash !== "string") {
      throw new Error("Your wallet didn't return the NEAR transaction hash.");
    }

    setStep("submitting");
    const finished = await finish({ data: { sweepId, nearTxHash } });
    if (!finished.ok) throw new Error(finished.message);
    if (finished.status === "failed") throw new Error(finished.error ?? "The Sweep failed.");
    setAmount("");
    setNotice(
      finished.status === "awaiting_signature"
        ? "The MPC network is still signing. Herald submits the transfer once the signature is on NEAR."
        : finished.destinationKind === "same_chain"
          ? "Herald submitted the transfer. Follow it below."
          : "Herald submitted the transfer to 1Click's deposit address. Follow the delivery below.",
    );
  }

  /** Runs one step of the Sweep, showing what went wrong and refreshing the page after. */
  async function run(first: Step, action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      setStep(first);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Sweep didn't finish. Try again.");
    } finally {
      setStep("idle");
      // New balances, the cap count and the Sweep list.
      await router.invalidate();
    }
  }

  const handleSameChain = () =>
    run("planning", async () => {
      const planned = await requestPlan();
      await signAndFinish(planned.sweepId, planned.signRequest);
    });

  const handleQuote = () =>
    run("quoting", async () => {
      setQuoted(null);
      const planned = await requestPlan();
      if (!planned.quote) throw new Error("Herald didn't answer a 1Click quote.");
      setNow(Date.now());
      setQuoted({
        sweepId: planned.sweepId,
        signRequest: planned.signRequest,
        quote: planned.quote,
      });
    });

  const handleSignQuote = () => {
    if (!quoted) return;
    const { sweepId, signRequest, quote } = quoted;
    if (Date.now() >= quote.signBy.getTime()) return;
    return run("signing", async () => {
      // Signed or not, this quote is used up: the next Sweep gets a fresh one.
      setQuoted(null);
      await signAndFinish(sweepId, signRequest);
    });
  };

  const destinationLabel = kind === "intents" ? "NEAR Intents" : (addressChain?.label ?? "Not set");

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Sweep</CardTitle>
        <CardDescription>
          {viaOneClick
            ? "USDC only. 1Click delivers it and keeps a fee, shown in the quote before you sign."
            : "Same chain, USDC only. The destination receives the full amount."}
        </CardDescription>
        <CardAction>
          <Badge variant={props.capReached ? "destructive" : "outline"}>
            {props.submittedToday} of {props.dailyCap} today
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {props.capReached ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>Daily limit reached</AlertTitle>
            <AlertDescription>
              Herald submits at most {props.dailyCap} Sweeps per Provider in 24 hours. Try again
              later.
            </AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel>From</FieldLabel>
            <ToggleGroup
              value={[network]}
              onValueChange={(value) => {
                const next = props.chains.find((c) => c.network === value[0]);
                if (!next) return;
                edit(() => {
                  // An address on one kind of chain is never one on the other.
                  if (kind === "same_chain" && next.kind !== chain.kind) setDestination("");
                  setNetwork(next.network);
                });
              }}
              variant="outline"
              disabled={busy}
            >
              {props.chains.map((option) => (
                <ToggleGroupItem key={option.network} value={option.network}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {chain.balance.ok
                ? `Available: ${formatUsdc(chain.balance.amount)} USDC.`
                : chain.balance.message}{" "}
              {chain.minimum !== null
                ? `Minimum Sweep: ${formatUsdc(chain.minimum)} USDC.`
                : `Herald can't Sweep on ${chain.label} yet.`}
            </FieldDescription>
          </Field>
          <Field data-invalid={kindProblem ? true : undefined}>
            <FieldLabel>To</FieldLabel>
            <ToggleGroup
              value={[kind]}
              onValueChange={(value) => {
                const next = destinationKinds.find((d) => d.kind === value[0]);
                if (!next) return;
                edit(() => {
                  setKind(next.kind);
                  setDestination("");
                });
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
                ? `Any address on ${chain.label}.`
                : kind === "cross_chain"
                  ? "USDC at an address on another chain, through 1Click."
                  : `Credited to your NEAR Intents account, ${account.accountId}, as ${chain.label} USDC, through 1Click.`}
              {oneClickAvailable
                ? null
                : " Cross-chain and NEAR Intents Sweeps go through 1Click, which runs on mainnet only."}
            </FieldDescription>
            <FieldError>{kindProblem}</FieldError>
          </Field>
          {kind === "cross_chain" && destinationChains.length > 0 ? (
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
          ) : null}
          <Field data-invalid={amountProblem ? true : undefined}>
            <FieldLabel htmlFor="sweep-amount">Amount (USDC)</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="sweep-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="font-mono"
                value={amount}
                disabled={busy}
                aria-invalid={amountProblem ? true : undefined}
                onChange={(event) => edit(() => setAmount(event.target.value))}
              />
              {/* Left out rather than disabled: a disabled control greys out the whole group. */}
              {balance !== null && balance !== "0" && !busy ? (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    onClick={() => edit(() => setAmount(baseUnitsToInput(balance)))}
                  >
                    Max
                  </InputGroupButton>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <FieldError>{amountProblem}</FieldError>
          </Field>
          {addressChain ? (
            <Field data-invalid={destinationProblem ? true : undefined}>
              <FieldLabel htmlFor="sweep-destination">Destination address</FieldLabel>
              <Input
                id="sweep-destination"
                autoComplete="off"
                spellCheck={false}
                placeholder={addressChain.kind === "evm" ? "0x…" : "Solana wallet address"}
                className="font-mono"
                value={destination}
                disabled={busy}
                aria-invalid={destinationProblem ? true : undefined}
                onChange={(event) => edit(() => setDestination(event.target.value))}
              />
              <FieldDescription>
                {addressChain.kind === "evm"
                  ? `Any address on ${addressChain.label} that can hold USDC.`
                  : kind === "same_chain"
                    ? `A wallet address on ${addressChain.label}, not a token account. If it has no USDC account yet, Herald creates one.`
                    : `A wallet address on ${addressChain.label}, not a token account.`}{" "}
                Double-check it: a Sweep can't be undone.
              </FieldDescription>
              <FieldError>{destinationProblem}</FieldError>
            </Field>
          ) : null}
        </FieldGroup>

        {quoted ? (
          <QuoteReview
            chain={chain}
            destinationLabel={destinationLabel}
            recipient={kind === "intents" ? account.accountId : trimmedDestination}
            quote={quoted.quote}
            secondsLeft={secondsLeft}
          />
        ) : (
          <SweepSummary
            chain={chain}
            kind={kind}
            destinationLabel={destinationLabel}
            amount={baseUnits !== null && amountProblem === null ? baseUnits : null}
            recipient={
              kind === "intents"
                ? account.accountId
                : destination && !destinationProblem
                  ? trimmedDestination
                  : null
            }
          />
        )}

        {quoteExpired ? (
          <Alert>
            <TimerIcon />
            <AlertTitle>This quote expired</AlertTitle>
            <AlertDescription>
              It had to be signed by {formatUtc(quoted.quote.signBy)}, so the transfer reaches
              1Click in time. Get a fresh quote to Sweep.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The Sweep didn't go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertTitle>Sweep started</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex gap-2">
        {!viaOneClick ? (
          <Button className="w-full" disabled={!ready} onClick={handleSameChain}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? stepLabels[step] : "Sweep with NEAR wallet"}
          </Button>
        ) : quoted && !quoteExpired ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => setQuoted(null)}>
              Discard quote
            </Button>
            <Button
              className="flex-1"
              disabled={busy || props.capReached}
              onClick={handleSignQuote}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? stepLabels[step] : "Sign with NEAR wallet"}
            </Button>
          </>
        ) : (
          <Button className="w-full" disabled={!ready} onClick={handleQuote}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? stepLabels[step] : quoteExpired ? "Get a fresh quote" : "Get 1Click quote"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

type SummaryRow = { term: string; value: string | null; mono?: boolean; title?: string };

function SummaryList({ rows }: { rows: SummaryRow[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border p-4">
      {rows.map(({ term, value, mono, title }) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className={cn("min-w-0", mono && value && "truncate font-mono")} title={title}>
            {value ?? <span className="text-muted-foreground">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const approveOnce = "One NEAR transaction to the MPC signer: 1 yoctoNEAR plus NEAR gas.";

/** What the Sweep will do, before the Provider signs it or asks for a quote. */
function SweepSummary(props: {
  chain: SweepChainOption;
  kind: SweepDestinationKind;
  destinationLabel: string;
  amount: string | null;
  recipient: string | null;
}) {
  const { chain, kind } = props;
  const amount = props.amount ? `${formatUsdc(props.amount)} USDC` : null;
  const viaOneClick = kind !== "same_chain";
  const rows: SummaryRow[] = [
    {
      term: "From",
      value: `${chain.label} · ${shortenMiddle(chain.address, 8, 6)}`,
      title: chain.address,
    },
    {
      term: "To",
      value: props.recipient
        ? `${props.destinationLabel} · ${shortenMiddle(props.recipient, 8, 6)}`
        : null,
      title: props.recipient ?? undefined,
    },
    { term: "You send", value: amount, mono: true },
    {
      term: "Destination receives",
      value: viaOneClick ? "1Click quotes it before you sign." : amount,
      mono: !viaOneClick,
    },
    {
      term: "Fee",
      value: viaOneClick
        ? `1Click's, shown in the quote. Herald pays the gas on ${chain.label}.`
        : chain.kind === "evm"
          ? `None. Herald pays the gas on ${chain.label}.`
          : `None. Herald pays the fee on ${chain.label}, and the rent of the destination's USDC account if it needs one.`,
    },
    {
      term: "You approve",
      value:
        chain.kind === "evm"
          ? approveOnce
          : `${approveOnce} Approve it right away: the Solana transaction expires about a minute after you start.`,
    },
  ];
  return <SummaryList rows={rows} />;
}

/** A live 1Click quote, for the Provider to check before signing. */
function QuoteReview(props: {
  chain: SweepChainOption;
  destinationLabel: string;
  recipient: string;
  quote: SweepQuote;
  secondsLeft: number;
}) {
  const { chain, quote } = props;
  const rows: SummaryRow[] = [
    {
      term: "From",
      value: `${chain.label} · ${shortenMiddle(chain.address, 8, 6)}`,
      title: chain.address,
    },
    {
      term: "To",
      value: `${props.destinationLabel} · ${shortenMiddle(props.recipient, 8, 6)}`,
      title: props.recipient,
    },
    { term: "You send", value: `${formatUsdc(quote.amountIn)} USDC`, mono: true },
    {
      term: "You receive",
      value: `${formatUsdc(quote.amountOut)} USDC (at least ${formatUsdc(quote.minAmountOut)})`,
      mono: true,
    },
    { term: "1Click fee", value: `${formatUsdc(quote.fee)} USDC`, mono: true },
    {
      term: "Minimum",
      value: `${formatUsdc(quote.minimum)} USDC, 1Click's minimum deposit from ${chain.label}`,
    },
    {
      term: "Time",
      value: `About ${quote.timeEstimateSeconds} s after the transfer confirms on ${chain.label}`,
    },
    {
      term: "If it fails",
      value: `1Click refunds your Receiving Address on ${chain.label}, keeping up to ${formatUsdc(quote.refundFee)} USDC.`,
    },
    {
      term: "Deposit address",
      value: shortenMiddle(quote.depositAddress, 8, 6),
      mono: true,
      title: quote.depositAddress,
    },
    {
      term: "Sign within",
      value:
        props.secondsLeft > 0
          ? `${formatCountdown(props.secondsLeft)}${chain.kind === "solana" ? ". The Solana transaction expires about a minute after the quote" : ""}`
          : "Expired",
      mono: props.secondsLeft > 0,
    },
  ];
  return <SummaryList rows={rows} />;
}

const statusBadges = {
  planned: { label: "Not signed", variant: "outline" },
  awaiting_signature: { label: "Awaiting signature", variant: "secondary" },
  submitted: { label: "Submitted", variant: "secondary" },
  confirmed: { label: "Confirmed", variant: "default" },
  delivering: { label: "Delivering", variant: "secondary" },
  delivered: { label: "Delivered", variant: "default" },
  refunded: { label: "Refunded", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
} as const satisfies Record<SweepStatus, { label: string; variant: string }>;

function SweepTable({ sweeps }: { sweeps: SweepEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>From</TableHead>
          <TableHead className="text-right">USDC</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sweeps.map((sweep) => {
          const badge = statusBadges[sweep.status];
          return (
            <TableRow key={sweep.id}>
              <TableCell>{formatUtc(sweep.createdAt)}</TableCell>
              <TableCell>
                <Badge variant="outline">{sweep.label}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatUsdc(sweep.amount)}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  {sweep.destinationKind === "same_chain" ? null : (
                    <Badge variant="outline">{sweep.destinationLabel}</Badge>
                  )}
                  <span className="font-mono" title={sweep.destinationAddress}>
                    {shortenMiddle(sweep.destinationAddress)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex max-w-64 flex-col items-start gap-1">
                  <Badge variant={badge.variant}>
                    {inFlight(sweep) ? <Spinner data-icon="inline-start" /> : null}
                    {badge.label}
                  </Badge>
                  {sweep.status === "delivered" && sweep.deliveredAmount ? (
                    <span className="text-muted-foreground">
                      Received {formatUsdc(sweep.deliveredAmount)} USDC.
                    </span>
                  ) : null}
                  {sweep.error ? (
                    <span className="text-muted-foreground">{sweep.error}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <TxLink label="NEAR" url={sweep.nearTxUrl} hash={sweep.nearTxHash} />
                  <TxLink label={sweep.label} url={sweep.sourceTxUrl} hash={sweep.sourceTxHash} />
                  <TxLink
                    label="1Click"
                    url={sweep.oneClickUrl}
                    hash={sweep.oneClickDepositAddress}
                  />
                  <TxLink
                    label={sweep.destinationLabel}
                    url={sweep.deliveryTxUrl}
                    hash={sweep.deliveryTxHash}
                  />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TxLink(props: { label: string; url: string | null; hash: string | null }) {
  if (!props.url || !props.hash) return null;
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono underline-offset-4 hover:underline"
      title={props.hash}
    >
      {props.label} {shortenMiddle(props.hash, 6, 4)}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
      <span className="sr-only">(opens the block explorer)</span>
    </a>
  );
}
