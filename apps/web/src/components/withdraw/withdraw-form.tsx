import {
  PriceSchema,
  priceToBaseUnits,
  USDC_DECIMALS,
  type HeraldEnv,
  type SweepDestinationKind,
} from "@herald/core";
import type { MpcSignRequest, SweepChainOption, SweepQuote } from "@herald/core/server";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircleIcon,
  CircleCheckIcon,
  InfinityIcon,
  TimerIcon,
  WalletIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NetworkLogo } from "@/components/money/network-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { formatUsdc, formatUtc } from "@/lib/format";
import { walletFor } from "@/lib/near-wallet";
import { inPlainWords } from "@/lib/plain-words";
import { discardPlannedSweep, finishSweep, startSweep } from "@/server/sweeps";
import { OptionSelect, type Option } from "./option-select";
import { QuoteReview, WithdrawSummary } from "./withdraw-review";
import { WithdrawLayout } from "./withdraw-layout";
import { addressProblem, type Step } from "./withdraw-shared";

const stepLabels: Record<Exclude<Step, "idle">, string> = {
  planning: "Preparing your withdrawal…",
  quoting: "Getting a quote…",
  signing: "Approve it in your wallet…",
  submitting: "Sending…",
};

/** Where the money goes: a network's id, or NEAR Intents. */
const INTENTS = "intents";

/** A planned bridge withdrawal waiting for you to check its quote and approve it. */
type QuotedSweep = { sweepId: number; signRequest: MpcSignRequest; quote: SweepQuote };

/**
 * A USDC amount typed in (`"1.5"`) in base units, or null if it isn't a
 * positive amount with at most 6 decimals.
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

/** The round logo for NEAR Intents in a destination list. */
export function IntentsLogo() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
      <InfinityIcon aria-hidden className="size-4" />
    </span>
  );
}

/**
 * Withdraw USDC from one network. Sending to the same network goes straight
 * to the wallet; another network or NEAR Intents goes through the 1Click
 * bridge, quoted first. Your NEAR wallet approves it once; Herald pays the
 * network fee.
 */
export function WithdrawFromNetwork(props: {
  picker: ReactNode;
  chain: SweepChainOption;
  chains: SweepChainOption[];
  capReached: boolean;
  accountId: string;
  heraldEnv: HeraldEnv;
}) {
  const { accountId, heraldEnv, chain } = props;
  const router = useRouter();
  const plan = useServerFn(startSweep);
  const finish = useServerFn(finishSweep);
  const discard = useServerFn(discardPlannedSweep);
  const [target, setTarget] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [quoted, setQuoted] = useState<QuotedSweep | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Count down the quote's approval window.
  useEffect(() => {
    if (!quoted) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [quoted]);

  const bridgeAvailable = props.chains.some((c) => c.oneClick);
  const bridgeable = bridgeAvailable && chain.oneClick;
  // Same network, another network or NEAR Intents, read off the destination.
  const kind: SweepDestinationKind =
    target === INTENTS
      ? "intents"
      : target === chain.network || !target
        ? "same_chain"
        : "cross_chain";
  const viaBridge = kind !== "same_chain";
  const targetChain = props.chains.find((c) => c.network === target);
  // The network the destination address is on: none for NEAR Intents.
  const addressChain = kind === "intents" ? undefined : targetChain;

  const destinations: Option[] = [
    {
      value: chain.network,
      label: chain.label,
      icon: <NetworkLogo label={chain.label} size="md" />,
    },
    ...props.chains
      .filter((c) => c.network !== chain.network)
      .map((c) => ({
        value: c.network,
        label: c.label,
        icon: <NetworkLogo label={c.label} size="md" />,
        disabled: !bridgeable || !c.oneClick,
      })),
    {
      value: INTENTS,
      label: "NEAR Intents",
      icon: <IntentsLogo />,
      disabled: !bridgeable,
    },
  ];

  const balance = chain.balance.ok ? chain.balance.amount : null;
  const baseUnits = usdcToBaseUnits(amount);
  const amountProblem = !amount
    ? null
    : baseUnits === null
      ? "Enter an amount, like 1.50."
      : chain.minimum !== null && BigInt(baseUnits) < BigInt(chain.minimum)
        ? `You can withdraw ${formatUsdc(chain.minimum)} USDC or more from ${chain.label}.`
        : balance !== null && BigInt(baseUnits) > BigInt(balance)
          ? `You have ${formatUsdc(balance)} USDC on ${chain.label}.`
          : null;
  const trimmedDestination = destination.trim();
  // EVM addresses are case-insensitive; Solana's base58 ones aren't. A
  // payment address on another network is fine: that's consolidating.
  const isOwnAddress =
    kind === "same_chain" &&
    (chain.kind === "evm"
      ? trimmedDestination.toLowerCase() === chain.address.toLowerCase()
      : trimmedDestination === chain.address);
  const destinationProblem =
    !addressChain || !destination
      ? null
      : (addressProblem(trimmedDestination, addressChain.kind) ??
        (isOwnAddress ? "That's your own payment address. Enter a different one." : null));
  const busy = step !== "idle";
  const ready =
    !busy &&
    !props.capReached &&
    target !== null &&
    balance !== null &&
    chain.minimum !== null &&
    baseUnits !== null &&
    amountProblem === null &&
    (!viaBridge || bridgeable) &&
    (addressChain === undefined || (destination !== "" && destinationProblem === null));
  const secondsLeft = quoted ? (quoted.quote.signBy.getTime() - now) / 1000 : 0;
  const quoteExpired = quoted !== null && secondsLeft <= 0;

  // Any change makes a quote stale: drop it so it can't be approved later.
  function edit(change: () => void) {
    change();
    dropQuote();
    setNotice(null);
  }

  function dropQuote() {
    if (!quoted) return;
    // Best effort: an unapproved quote expires on its own anyway.
    void discard({ data: { sweepId: quoted.sweepId } }).catch(() => undefined);
    setQuoted(null);
  }

  async function requestPlan() {
    if (baseUnits === null) throw new Error("Enter an amount, like 1.50.");
    const base = { network: chain.network, amount: baseUnits };
    const planned = await plan({
      data:
        kind === "same_chain"
          ? { ...base, destinationKind: "same_chain", destination: trimmedDestination }
          : kind === "cross_chain"
            ? {
                ...base,
                destinationKind: "cross_chain",
                destinationNetwork: target ?? "",
                destination: trimmedDestination,
              }
            : { ...base, destinationKind: "intents" },
    });
    if (!planned.ok) throw new Error(planned.message);
    return planned;
  }

  /** Has your wallet ask the MPC signer to sign, then hands the NEAR transaction to Herald. */
  async function signAndFinish(sweepId: number, signRequest: MpcSignRequest) {
    setStep("signing");
    const wallet = await walletFor(heraldEnv, accountId);
    const outcome = await wallet.signAndSendTransaction({
      network: heraldEnv,
      signerId: accountId,
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
      throw new Error("Your wallet didn't return the NEAR transaction.");
    }

    setStep("submitting");
    const finished = await finish({ data: { sweepId, nearTxHash } });
    if (!finished.ok) throw new Error(finished.message);
    if (finished.status === "failed") throw new Error(finished.error ?? "The withdrawal failed.");
    setAmount("");
    setNotice(
      finished.status === "awaiting_signature"
        ? "Your approval is being confirmed. Herald sends the money as soon as it is."
        : finished.destinationKind === "same_chain"
          ? "Herald is sending your money. Follow it in the history below."
          : "Herald handed your money to the bridge. Follow its delivery in the history below.",
    );
  }

  /** Runs one step, shows what went wrong, and refreshes the page after. */
  async function run(first: Step, action: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      setStep(first);
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? inPlainWords(cause.message)
          : "The withdrawal didn't finish. Try again.",
      );
    } finally {
      setStep("idle");
      // New balances, the daily count and the history.
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
      dropQuote();
      const planned = await requestPlan();
      if (!planned.quote) throw new Error("Herald didn't get a quote from the bridge.");
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
      // Approved or not, this quote is used up: the next withdrawal gets a fresh one.
      setQuoted(null);
      await signAndFinish(sweepId, signRequest);
    });
  };

  const destinationLabel = kind === "intents" ? "NEAR Intents" : (targetChain?.label ?? "Not set");

  const fields = (
    <>
      <Field>
        <FieldLabel htmlFor="withdraw-to">Send to</FieldLabel>
        <OptionSelect
          id="withdraw-to"
          value={target}
          options={destinations}
          disabled={busy}
          onChange={(next) =>
            edit(() => {
              const nextChain = props.chains.find((c) => c.network === next);
              // An address on one kind of network is never one on the other.
              if (nextChain?.kind !== addressChain?.kind) setDestination("");
              setTarget(next);
            })
          }
        />
        <FieldDescription>
          {!target
            ? `${chain.label} sends straight to a wallet; other networks go through the 1Click bridge.`
            : kind === "same_chain"
              ? "Straight to a wallet. It receives the full amount."
              : kind === "cross_chain"
                ? "Through the 1Click bridge, which keeps a small fee shown before you approve."
                : `Lands in your NEAR Intents account, ${accountId}.`}
          {bridgeAvailable ? null : " Other networks and NEAR Intents open in Live mode."}
        </FieldDescription>
      </Field>

      {addressChain ? (
        <Field data-invalid={destinationProblem ? true : undefined}>
          <FieldLabel htmlFor="withdraw-destination">
            Wallet address on {addressChain.label}
          </FieldLabel>
          <Input
            id="withdraw-destination"
            autoComplete="off"
            spellCheck={false}
            placeholder={addressChain.kind === "evm" ? "0x…" : "Solana wallet address"}
            className="h-11 font-mono text-[0.8rem]"
            value={destination}
            disabled={busy}
            aria-invalid={destinationProblem ? true : undefined}
            onChange={(event) => edit(() => setDestination(event.target.value))}
          />
          <FieldDescription>Check it twice: a withdrawal can't be undone.</FieldDescription>
          <FieldError>{destinationProblem}</FieldError>
        </Field>
      ) : null}

      <Field data-invalid={amountProblem ? true : undefined}>
        <FieldLabel htmlFor="withdraw-amount">Amount</FieldLabel>
        <InputGroup className="h-11">
          <InputGroupInput
            id="withdraw-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="amount text-base"
            value={amount}
            disabled={busy}
            aria-invalid={amountProblem ? true : undefined}
            onChange={(event) => edit(() => setAmount(event.target.value))}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>USDC</InputGroupText>
            {/* Left out rather than disabled: a disabled control greys out the whole group. */}
            {balance !== null && balance !== "0" && !busy ? (
              <InputGroupButton
                variant="secondary"
                onClick={() => edit(() => setAmount(baseUnitsToInput(balance)))}
              >
                Max
              </InputGroupButton>
            ) : null}
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription className="amount">
          {balance !== null
            ? `You have ${formatUsdc(balance)} USDC on ${chain.label}.`
            : `Herald couldn't read your balance on ${chain.label}.`}{" "}
          {chain.minimum !== null
            ? `The smallest withdrawal is ${formatUsdc(chain.minimum)} USDC.`
            : `Withdrawals from ${chain.label} aren't open yet.`}
        </FieldDescription>
        <FieldError>{amountProblem}</FieldError>
      </Field>
    </>
  );

  const messages =
    quoteExpired || error || notice ? (
      <div className="flex flex-col gap-3">
        {quoteExpired ? (
          <Alert>
            <TimerIcon />
            <AlertTitle>This quote expired</AlertTitle>
            <AlertDescription>
              It had to be approved by {formatUtc(quoted.quote.signBy)}, so the money reaches the
              bridge in time. Get a new quote to withdraw.
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>The withdrawal didn't go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <CircleCheckIcon className="text-success" />
            <AlertTitle>Withdrawal started</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    ) : null;

  const summary = quoted ? (
    <QuoteReview
      chain={chain}
      destinationLabel={destinationLabel}
      recipient={kind === "intents" ? accountId : trimmedDestination}
      quote={quoted.quote}
      secondsLeft={secondsLeft}
    />
  ) : (
    <WithdrawSummary
      chain={chain}
      kind={kind}
      destinationLabel={destinationLabel}
      amount={baseUnits !== null && amountProblem === null ? baseUnits : null}
      recipient={
        kind === "intents"
          ? accountId
          : destination && !destinationProblem
            ? trimmedDestination
            : null
      }
    />
  );

  const footer = !viaBridge ? (
    <Button size="lg" className="w-full sm:w-auto" disabled={!ready} onClick={handleSameChain}>
      {busy ? <Spinner data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
      {busy ? stepLabels[step] : "Approve withdrawal in wallet"}
    </Button>
  ) : quoted && !quoteExpired ? (
    <>
      <Button size="lg" variant="outline" disabled={busy} onClick={dropQuote}>
        Discard quote
      </Button>
      <Button
        size="lg"
        className="flex-1 sm:flex-none"
        disabled={busy || props.capReached}
        onClick={handleSignQuote}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <WalletIcon data-icon="inline-start" />}
        {busy ? stepLabels[step] : "Approve withdrawal in wallet"}
      </Button>
    </>
  ) : (
    <Button size="lg" className="w-full sm:w-auto" disabled={!ready} onClick={handleQuote}>
      {busy ? <Spinner data-icon="inline-start" /> : null}
      {busy ? stepLabels[step] : quoteExpired ? "Get a new quote" : "Get a quote"}
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
