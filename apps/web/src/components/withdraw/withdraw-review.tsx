import type { SweepDestinationKind } from "@herald/core";
import type { SweepChainOption, SweepQuote } from "@herald/core/server";
import { TimerIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatUsdc, shortenMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { approveOnce, formatCountdown } from "./withdraw-shared";

type SummaryRow = {
  term: string;
  value: string | null;
  mono?: boolean;
  title?: string;
  strong?: boolean;
};

/** A withdrawal laid out like a receipt, one line per fact. */
function SummaryList({
  title,
  aside,
  rows,
}: {
  title: string;
  aside?: ReactNode;
  rows: SummaryRow[];
}) {
  return (
    <section className="flex flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside}
      </div>
      <dl className="flex flex-col px-4 py-1">
        {rows.map(({ term, value, mono, title: hover, strong }) => (
          <div
            key={term}
            className="grid grid-cols-[8.5rem_1fr] gap-x-4 border-b border-dashed py-2.5 text-sm last:border-b-0 sm:grid-cols-[10rem_1fr]"
          >
            <dt className="text-muted-foreground">{term}</dt>
            <dd
              className={cn(
                "min-w-0 text-pretty",
                mono && value && "amount truncate",
                strong && value && "font-semibold",
              )}
              title={hover}
            >
              {value ?? <span className="text-muted-foreground">Not set yet</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** What the withdrawal will do, before you approve it or ask for a quote. */
export function WithdrawSummary(props: {
  chain: SweepChainOption;
  kind: SweepDestinationKind;
  destinationLabel: string;
  amount: string | null;
  recipient: string | null;
}) {
  const { chain, kind } = props;
  const amount = props.amount ? `${formatUsdc(props.amount)} USDC` : null;
  const viaBridge = kind !== "same_chain";
  const rows: SummaryRow[] = [
    {
      term: "From",
      value: `${chain.label} · ${shortenMiddle(chain.address, 6, 4)}`,
      title: chain.address,
    },
    {
      term: "To",
      value: props.recipient
        ? `${props.destinationLabel} · ${shortenMiddle(props.recipient, 6, 4)}`
        : null,
      title: props.recipient ?? undefined,
    },
    { term: "You send", value: amount, mono: true },
    {
      term: "They receive",
      value: viaBridge ? "Shown in the quote, before you approve." : amount,
      mono: !viaBridge,
      strong: !viaBridge,
    },
    {
      term: "Fees",
      value: viaBridge
        ? `The bridge's fee, shown in the quote. Herald pays the network fee on ${chain.label}.`
        : chain.kind === "evm"
          ? `None. Herald pays the network fee on ${chain.label}.`
          : `None. Herald pays the network fee on ${chain.label}, and opens a USDC account for the wallet if it needs one.`,
    },
    {
      term: "You approve",
      value:
        chain.kind === "evm"
          ? approveOnce
          : `${approveOnce} Approve it right away: on Solana it expires about a minute after you start.`,
    },
  ];
  return <SummaryList title="Summary" rows={rows} />;
}

/** A live bridge quote, to check before approving. */
export function QuoteReview(props: {
  chain: SweepChainOption;
  destinationLabel: string;
  recipient: string;
  quote: SweepQuote;
  secondsLeft: number;
}) {
  const { chain, quote } = props;
  const live = props.secondsLeft > 0;
  const rows: SummaryRow[] = [
    {
      term: "From",
      value: `${chain.label} · ${shortenMiddle(chain.address, 6, 4)}`,
      title: chain.address,
    },
    {
      term: "To",
      value: `${props.destinationLabel} · ${shortenMiddle(props.recipient, 6, 4)}`,
      title: props.recipient,
    },
    { term: "You send", value: `${formatUsdc(quote.amountIn)} USDC`, mono: true },
    {
      term: "They receive",
      value: `${formatUsdc(quote.amountOut)} USDC (at least ${formatUsdc(quote.minAmountOut)})`,
      mono: true,
      strong: true,
    },
    { term: "Bridge fee", value: `${formatUsdc(quote.fee)} USDC`, mono: true },
    {
      term: "Smallest amount",
      value: `${formatUsdc(quote.minimum)} USDC from ${chain.label}`,
    },
    {
      term: "Arrives in",
      value: `About ${quote.timeEstimateSeconds} seconds after it leaves ${chain.label}`,
    },
    {
      term: "If it fails",
      value: `The money comes back to your ${chain.label} address, less up to ${formatUsdc(quote.refundFee)} USDC.`,
    },
    {
      term: "Bridge address",
      value: shortenMiddle(quote.depositAddress, 6, 4),
      title: quote.depositAddress,
    },
  ];
  return (
    <SummaryList
      title="Quote from 1Click"
      aside={
        <Badge variant={live ? "brand" : "destructive"} className="amount">
          <TimerIcon data-icon="inline-start" />
          {live ? `Approve within ${formatCountdown(props.secondsLeft)}` : "Expired"}
        </Badge>
      }
      rows={
        chain.kind === "solana" && live
          ? [
              ...rows,
              {
                term: "Heads up",
                value: "On Solana the transfer expires about a minute after the quote.",
              },
            ]
          : rows
      }
    />
  );
}
