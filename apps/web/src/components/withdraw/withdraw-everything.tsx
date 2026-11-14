import type { HeraldEnv, SweepDestinationKind } from "@herald/core";
import type { SweepChainOption } from "@herald/core/server";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircleIcon, LayersIcon, TimerIcon, WalletIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { CoinAmount } from "@/components/money/amount";
import { NetworkAvatar, NetworkLogo } from "@/components/money/network-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatUsdc, shortenMiddle } from "@/lib/format";
import {
  nearGasPayer,
  signEachInOwnTransaction,
  signSponsoredSigns,
  walletFor,
  watchNearGasPayer,
  type NearGasPayer,
  type NearWallet as Wallet,
} from "@/lib/near-wallet";
import { inPlainWords } from "@/lib/plain-words";
import { USDC } from "@/lib/stablecoins";
import { cn } from "@/lib/utils";
import { discardPlannedSweep, finishSweep, sponsorSweepAll, startSweepAll } from "@/server/sweeps";
import { OptionSelect, type Option } from "./option-select";
import { IntentsLogo } from "./withdraw-form";
import { WithdrawLayout } from "./withdraw-layout";
import {
  addressPlaceholder,
  addressProblem,
  formatCountdown,
  nearGasLine,
  type Step,
} from "./withdraw-shared";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  planning: "Preparing your withdrawals…",
  quoting: "Getting quotes…",
  signing: "Approve them in your wallet…",
  submitting: "Sending…",
};

/** The destination that isn't a network. */
const INTENTS = "intents";

// How often a sponsored batch is presented again when Herald's relayer
// didn't answer, and how long apart. Each approval is relayed at most once.
const SPONSOR_ATTEMPTS = 3;
const SPONSOR_RETRY_MS = 2_000;

type Planned = Extract<Awaited<ReturnType<typeof startSweepAll>>, { ok: true }>;

/** How one network's withdrawal went, for the summary after approving. */
type Outcome = { label: string; ok: boolean; message: string };

/**
 * Withdraw everything: the whole balance of every network holding at least
 * its minimum, one withdrawal per network. A wallet that signs delegate
 * actions approves them all at once and Herald's relayer sends each one,
 * paying the NEAR gas (ADR 0010); any other wallet sends one NEAR
 * transaction per withdrawal, in one request where it can. Each is
 * followed on its own.
 */
export function WithdrawEverything(props: {
  picker: ReactNode;
  chains: SweepChainOption[];
  heraldEnv: HeraldEnv;
  accountId: string;
  submittedToday: number;
  dailyCap: number;
}) {
  const router = useRouter();
  const plan = useServerFn(startSweepAll);
  const finish = useServerFn(finishSweep);
  const sponsor = useServerFn(sponsorSweepAll);
  const discard = useServerFn(discardPlannedSweep);
  const [target, setTarget] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [quoted, setQuoted] = useState<Planned | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Who pays the NEAR gas with the wallet connected now: null until one is.
  const [gasPayer, setGasPayer] = useState<NearGasPayer | null>(null);

  useEffect(() => watchNearGasPayer(props.heraldEnv, setGasPayer), [props.heraldEnv]);

  useEffect(() => {
    if (!quoted) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quoted]);

  const chains = props.chains.filter((chain) => chain.sweepAll);
  const labelOf = (network: string) =>
    props.chains.find((c) => c.network === network)?.label ?? network;
  const bridgeAvailable = props.chains.some((c) => c.oneClick);
  // Everything lands on one network, or in NEAR Intents; both go through the bridge.
  const kind: Exclude<SweepDestinationKind, "same_chain"> =
    target === INTENTS ? "intents" : "cross_chain";
  const destinationChain = props.chains.find((c) => c.network === target);
  const room = Math.max(props.dailyCap - props.submittedToday, 0);
  const total = chains
    .reduce((sum, c) => sum + (c.balance.ok ? BigInt(c.balance.amount) : 0n), 0n)
    .toString();

  const destinations: Option[] = [
    ...props.chains.map((c) => ({
      value: c.network,
      label: c.label,
      icon: <NetworkLogo label={c.label} size="md" />,
      disabled: !bridgeAvailable || !c.oneClick,
    })),
    {
      value: INTENTS,
      label: "NEAR Intents",
      icon: <IntentsLogo />,
      disabled: !bridgeAvailable,
    },
  ];

  const crossAddress = destination.trim();
  const crossProblem =
    crossAddress && destinationChain ? addressProblem(crossAddress, destinationChain.kind) : null;
  const busy = step !== "idle";
  const ready =
    !busy &&
    chains.length > 0 &&
    room > 0 &&
    bridgeAvailable &&
    target !== null &&
    (kind === "intents" ||
      (destinationChain !== undefined && crossAddress !== "" && !crossProblem));
  const signBy = quoted
    ? Math.min(...quoted.planned.map((p) => p.quote?.signBy.getTime() ?? Infinity))
    : Infinity;
  const secondsLeft = (signBy - now) / 1000;
  const quotesExpired = quoted !== null && secondsLeft <= 0;

  function dropQuotes() {
    if (!quoted) return;
    // Best effort: unapproved withdrawals expire on their own anyway.
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
        kind === "cross_chain"
          ? {
              destinationKind: "cross_chain",
              destinationNetwork: target ?? "",
              destination: crossAddress,
            }
          : { destinationKind: "intents" },
    });
    if (!planned.ok) throw new Error(planned.message);
    if (planned.planned.length === 0) {
      throw new Error(
        planned.skipped.map((s) => `${s.label}: ${s.message}`).join(" ") ||
          "There's nothing to withdraw.",
      );
    }
    return planned;
  }

  /**
   * Approves every planned withdrawal and hands them to Herald. A wallet
   * that signs delegate actions signs every `sign` call in one request and
   * Herald's relayer sends them, paying the NEAR gas; any other wallet
   * sends them itself, as before. A sponsored approval that fails shows its
   * error: it never falls back to the wallet paying.
   */
  async function signAll(planned: Planned) {
    setStep("signing");
    const wallet = await walletFor(props.heraldEnv, props.accountId);
    const payer = nearGasPayer(wallet);
    setGasPayer(payer);
    const finished =
      payer === "herald" ? await sponsorAll(planned, wallet) : await sendAll(planned, wallet);
    const skipped = planned.skipped.map(({ label, message }) => ({
      label,
      ok: false,
      message: inPlainWords(message),
    }));
    setOutcomes([...finished, ...skipped]);
  }

  /**
   * Your wallet signs every `sign` call as a delegate action in one
   * request, and Herald relays each in its own NEAR transaction. Signing
   * sends nothing, so the withdrawals it didn't sign are discarded. The
   * batch is presented again a few times while the relayer doesn't answer:
   * each approval is relayed at most once.
   */
  async function sponsorAll(planned: Planned, wallet: Wallet): Promise<Outcome[]> {
    const sweepIds = planned.planned.map(({ sweepId }) => sweepId);
    let signedDelegateActions: string[];
    try {
      signedDelegateActions = await signSponsoredSigns(wallet, {
        heraldEnv: props.heraldEnv,
        signerId: props.accountId,
        requests: planned.planned.map(({ signRequest }) => signRequest),
      });
    } catch (cause) {
      for (const sweepId of sweepIds) void discard({ data: { sweepId } }).catch(() => undefined);
      throw cause;
    }

    setStep("submitting");
    let relayed = await sponsor({ data: { sweepIds, signedDelegateActions } });
    for (
      let attempt = 1;
      attempt < SPONSOR_ATTEMPTS && relayed.some((o) => !o.ok && o.retry);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, SPONSOR_RETRY_MS));
      relayed = await sponsor({ data: { sweepIds, signedDelegateActions } });
    }

    return planned.planned.map(({ sweepId, network, amount }): Outcome => {
      const label = labelOf(network);
      const result = relayed.find((o) => o.sweepId === sweepId);
      if (!result) return { label, ok: false, message: "Herald didn't answer for it." };
      if (!result.ok) {
        return {
          label,
          ok: false,
          message:
            result.reason === "not_signed"
              ? "Not approved: your wallet didn't sign it."
              : inPlainWords(result.message),
        };
      }
      if (result.status === "failed") {
        return {
          label,
          ok: false,
          message: result.error ? inPlainWords(result.error) : "The withdrawal failed.",
        };
      }
      return {
        label,
        ok: true,
        message:
          result.status === "awaiting_signature"
            ? `${formatUsdc(amount)} USDC: your approval is being confirmed.`
            : `${formatUsdc(amount)} USDC: on its way.`,
      };
    });
  }

  /** Your wallet sends each `sign` call in its own NEAR transaction, then Herald takes each hash. */
  async function sendAll(planned: Planned, wallet: Wallet): Promise<Outcome[]> {
    const signed = await signEachInOwnTransaction(wallet, {
      heraldEnv: props.heraldEnv,
      signerId: props.accountId,
      requests: planned.planned.map(({ signRequest }) => signRequest),
    });
    const sentAny = signed.hashes.some((hash) => hash !== null);
    // Nothing went out: the ones that certainly weren't sent can go, the
    // rest expire unapproved.
    if (signed.error && !sentAny) {
      planned.planned.forEach(({ sweepId }, index) => {
        if (signed.unsent[index]) void discard({ data: { sweepId } }).catch(() => undefined);
      });
      throw signed.error;
    }

    setStep("submitting");
    return Promise.all(
      planned.planned.map(async ({ sweepId, network, amount }, index): Promise<Outcome> => {
        const label = labelOf(network);
        const nearTxHash = signed.hashes[index];
        if (!nearTxHash) {
          if (signed.unsent[index]) void discard({ data: { sweepId } }).catch(() => undefined);
          return {
            label,
            ok: false,
            message: signed.unsent[index]
              ? "Not approved: your wallet stopped before it."
              : "Your wallet didn't return its NEAR transaction. If it went out, the history picks it up.",
          };
        }
        try {
          const result = await finish({ data: { sweepId, nearTxHash } });
          if (!result.ok) return { label, ok: false, message: inPlainWords(result.message) };
          if (result.status === "failed") {
            return {
              label,
              ok: false,
              message: result.error ? inPlainWords(result.error) : "The withdrawal failed.",
            };
          }
          return {
            label,
            ok: true,
            message:
              result.status === "awaiting_signature"
                ? `${formatUsdc(amount)} USDC: your approval is being confirmed.`
                : `${formatUsdc(amount)} USDC: on its way.`,
          };
        } catch {
          // The withdrawal keeps its NEAR transaction; the history picks it up.
          return { label, ok: true, message: "Approved. Follow it in the history below." };
        }
      }),
    );
  }

  async function run(first: Step, action: () => Promise<void>) {
    setError(null);
    setOutcomes(null);
    try {
      setStep(first);
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? inPlainWords(cause.message)
          : "The withdrawals didn't go through. Try again.",
      );
    } finally {
      setStep("idle");
      await router.invalidate();
    }
  }

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

  if (chains.length === 0) {
    return (
      <WithdrawLayout
        picker={props.picker}
        summary={
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing to withdraw yet</EmptyTitle>
              <EmptyDescription>
                A network joins once it holds at least its smallest withdrawal.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    );
  }

  const fields = (
    <>
      <Field>
        <FieldLabel htmlFor="withdraw-all-to">Send to</FieldLabel>
        <OptionSelect
          id="withdraw-all-to"
          value={target}
          options={destinations}
          disabled={busy}
          onChange={(next) =>
            edit(() => {
              const nextChain = props.chains.find((c) => c.network === next);
              if (nextChain?.kind !== destinationChain?.kind) setDestination("");
              setTarget(next);
            })
          }
        />
        <FieldDescription>
          {!target
            ? "Everything arrives on one network, through the 1Click bridge."
            : kind === "cross_chain"
              ? `${destinationChain?.label} sends directly; the other networks go through the 1Click bridge.`
              : `Everything lands in your NEAR Intents account, ${props.accountId}.`}
          {bridgeAvailable ? null : " Withdrawing from all networks at once works in Live mode."}
        </FieldDescription>
      </Field>

      {kind === "cross_chain" && destinationChain ? (
        <Field data-invalid={crossProblem ? true : undefined}>
          <FieldLabel htmlFor="withdraw-all-destination">
            Wallet address on {destinationChain.label}
          </FieldLabel>
          <Input
            id="withdraw-all-destination"
            autoComplete="off"
            spellCheck={false}
            placeholder={addressPlaceholder(destinationChain.kind)}
            className="h-11 font-mono text-[0.8rem]"
            value={destination}
            disabled={busy}
            aria-invalid={crossProblem ? true : undefined}
            onChange={(event) => edit(() => setDestination(event.target.value))}
          />
          <FieldError>{crossProblem}</FieldError>
        </Field>
      ) : null}
    </>
  );

  const messages =
    chains.length > room || error || outcomes ? (
      <div className="flex flex-col gap-3">
        {chains.length > room ? (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>Not every network fits today</AlertTitle>
            <AlertDescription>
              You can make up to {props.dailyCap} withdrawals in 24 hours, and {room}{" "}
              {room === 1 ? "is" : "are"} left. The rest wait for the next day.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The withdrawals didn't go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {outcomes ? (
          <Alert>
            <LayersIcon />
            <AlertTitle>Withdrawals started</AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-1">
                {outcomes.map((outcome) => (
                  <li key={outcome.label} className={cn(!outcome.ok && "text-destructive")}>
                    {outcome.label}: {outcome.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    ) : null;

  const summary = quoted ? (
    <QuotesReview
      planned={quoted}
      labelOf={labelOf}
      secondsLeft={secondsLeft}
      expired={quotesExpired}
      gasPayer={gasPayer}
    />
  ) : (
    <section className="flex flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Summary</h3>
      </div>
      <ul className="flex flex-col px-4 py-1">
        {chains.map((chain) => (
          <li
            key={chain.network}
            className="flex items-center justify-between gap-4 border-b border-dashed py-2.5 text-sm last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <NetworkAvatar label={chain.label} size="xs" />
              <span className="truncate text-muted-foreground">{chain.label}</span>
            </span>
            {chain.balance.ok ? (
              <CoinAmount
                baseUnits={chain.balance.amount}
                decimals={USDC.decimals}
                symbol={USDC.symbol}
              />
            ) : (
              <span className="text-muted-foreground">Unavailable</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-sm font-semibold">
        <span>You withdraw</span>
        <CoinAmount baseUnits={total} decimals={USDC.decimals} symbol={USDC.symbol} />
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        The bridge keeps a small fee on each network it moves, shown in the quotes. Herald pays the
        network fees. {nearGasLine(gasPayer)}
      </p>
    </section>
  );

  const footer =
    quoted && !quotesExpired ? (
      <>
        <Button size="lg" variant="outline" disabled={busy} onClick={dropQuotes}>
          Discard quotes
        </Button>
        <Button
          size="lg"
          className="flex-1 sm:flex-none"
          disabled={busy}
          onClick={handleSignQuotes}
        >
          {busy ? <Spinner data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
          {busy
            ? stepLabels[step]
            : `Approve ${quoted.planned.length} ${quoted.planned.length === 1 ? "withdrawal" : "withdrawals"}`}
        </Button>
      </>
    ) : (
      <Button size="lg" className="w-full sm:w-auto" disabled={!ready} onClick={handleQuote}>
        {busy ? <Spinner data-icon="inline-start" /> : null}
        {busy ? stepLabels[step] : quotesExpired ? "Get new quotes" : "Get quotes"}
      </Button>
    );

  return (
    <WithdrawLayout
      picker={props.picker}
      fields={fields}
      messages={messages}
      summary={summary}
      footer={footer}
    />
  );
}

/** The planned withdrawals and their bridge quotes, to check before approving. */
function QuotesReview(props: {
  planned: Planned;
  labelOf: (network: string) => string;
  secondsLeft: number;
  expired: boolean;
  gasPayer: NearGasPayer | null;
}) {
  return (
    <section className="flex flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Quotes from 1Click</h3>
        <Badge variant={props.expired ? "destructive" : "brand"} className="amount">
          <TimerIcon data-icon="inline-start" />
          {props.expired
            ? "Expired"
            : Number.isFinite(props.secondsLeft)
              ? `Approve within ${formatCountdown(props.secondsLeft)}`
              : "Approve right away"}
        </Badge>
      </div>
      <ul className="flex flex-col px-4 py-1 text-sm">
        {props.planned.planned.map(({ sweepId, network, amount, quote }) => (
          <li
            key={sweepId}
            className="flex flex-col gap-1 border-b border-dashed py-2.5 last:border-b-0"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <NetworkAvatar label={props.labelOf(network)} size="xs" />
                <span className="truncate text-muted-foreground">{props.labelOf(network)}</span>
              </span>
              <span className="amount font-medium">
                {formatUsdc(quote ? quote.amountOut : amount)} USDC
              </span>
            </span>
            <span className="amount text-xs text-muted-foreground">
              {quote ? (
                <>
                  Sends {formatUsdc(amount)}, fee {formatUsdc(quote.fee)}, via{" "}
                  <span title={quote.depositAddress}>
                    {shortenMiddle(quote.depositAddress, 6, 4)}
                  </span>
                </>
              ) : (
                "Same network, no fee"
              )}
            </span>
          </li>
        ))}
        {props.planned.skipped.map((s) => (
          <li key={s.network} className="py-2.5 text-muted-foreground">
            {s.label}: {inPlainWords(s.message)}
          </li>
        ))}
      </ul>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        {props.expired
          ? "These quotes expired. Get new ones to withdraw."
          : `If the bridge can't deliver, it sends the money back to the network it left. ${nearGasLine(props.gasPayer)}`}
      </p>
    </section>
  );
}
