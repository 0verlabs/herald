import { AlertCircleIcon, ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { shareOf, shortenMiddle } from "@/lib/format";
import { type NetworkHolding, type StablecoinHolding } from "@/lib/stablecoins";
import { inPlainWords } from "@/lib/plain-words";
import { CoinAmount } from "./amount";
import { CoinLogo } from "./coin-logo";
import { NetworkAvatar } from "./network-logo";

/**
 * Stablecoins first: one row per coin with its total across every network.
 * Each row opens to show the networks the coin sits on.
 */
export function StablecoinBalances(props: {
  holdings: StablecoinHolding[];
  defaultOpen?: boolean;
}) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-xl border">
      {props.holdings.map((holding, index) => (
        <li key={holding.coin.symbol} className="border-b last:border-b-0">
          <StablecoinRow holding={holding} defaultOpen={props.defaultOpen && index === 0} />
        </li>
      ))}
    </ul>
  );
}

function StablecoinRow({
  holding,
  defaultOpen,
}: {
  holding: StablecoinHolding;
  defaultOpen?: boolean;
}) {
  const { coin } = holding;

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group/coin flex w-full items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset">
        <CoinLogo symbol={coin.symbol} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-medium">{coin.symbol}</span>
          <span className="text-xs text-muted-foreground">{coin.name}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          {holding.loading ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <CoinAmount
              baseUnits={holding.total}
              decimals={coin.decimals}
              symbol={coin.symbol}
              className="font-medium"
            />
          )}
          {holding.unavailable > 0 ? (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircleIcon className="size-3" aria-hidden />
              {holding.unavailable === 1
                ? "1 network didn't answer"
                : `${holding.unavailable} networks didn't answer`}
            </span>
          ) : null}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/coin:rotate-180"
        />
        <span className="sr-only">Show {coin.symbol} by network</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0">
        <ul className="flex flex-col border-t bg-muted/40 px-4 py-1.5">
          {holding.networks.map((network) => (
            <NetworkRow
              key={network.network}
              network={network}
              total={holding.total}
              decimals={coin.decimals}
              symbol={coin.symbol}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NetworkRow(props: {
  network: NetworkHolding;
  total: string;
  decimals: number;
  symbol: string;
}) {
  const { network } = props;
  const share = network.amount === null ? 0 : shareOf(network.amount, props.total);

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[auto_1fr_8rem_auto]">
      <NetworkAvatar label={network.label} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{network.label}</span>
        {network.address ? (
          <span
            className="truncate font-mono text-xs text-muted-foreground"
            title={network.address}
          >
            {shortenMiddle(network.address, 6, 4)}
          </span>
        ) : null}
      </span>
      <Progress
        value={share}
        aria-label={`Share of your ${props.symbol} on ${network.label}`}
        className="hidden sm:flex"
      />
      <span className="text-right">
        {network.problem ? (
          <Badge variant="destructive" title={inPlainWords(network.problem)}>
            Couldn't read
          </Badge>
        ) : network.amount === null ? (
          <Skeleton className="ml-auto h-4 w-20" />
        ) : (
          <CoinAmount baseUnits={network.amount} decimals={props.decimals} symbol={props.symbol} />
        )}
      </span>
    </li>
  );
}
