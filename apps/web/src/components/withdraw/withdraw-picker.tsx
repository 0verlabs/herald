import type { SweepChainOption } from "@herald/core/server";
import { LayersIcon } from "lucide-react";
import { CoinLogo } from "@/components/money/coin-logo";
import { NetworkLogo } from "@/components/money/network-logo";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatUsdc } from "@/lib/format";
import { stablecoins } from "@/lib/stablecoins";
import { OptionSelect, type Option } from "./option-select";

/** The network picker's choice that withdraws from every network at once. */
export const ALL_NETWORKS = "all";

/** What to withdraw: a stablecoin, then the network it sits on (or all of them). */
export function WithdrawPicker(props: {
  chains: SweepChainOption[];
  coin: string | null;
  network: string | null;
  onCoin: (symbol: string) => void;
  onNetwork: (network: string) => void;
  disabled?: boolean;
}) {
  const total = props.chains
    .reduce((sum, c) => sum + (c.balance.ok ? BigInt(c.balance.amount) : 0n), 0n)
    .toString();

  const coins: Option[] = stablecoins.map((coin) => ({
    value: coin.symbol,
    label: coin.symbol,
    icon: <CoinLogo symbol={coin.symbol} />,
    aside: `${formatUsdc(total)}`,
  }));

  const networks: Option[] = [
    {
      value: ALL_NETWORKS,
      label: "All networks",
      icon: (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-primary">
          <LayersIcon aria-hidden className="size-4" />
        </span>
      ),
      aside: formatUsdc(total),
    },
    ...props.chains.map((chain) => ({
      value: chain.network,
      label: chain.label,
      icon: <NetworkLogo label={chain.label} size="md" />,
      aside: chain.balance.ok ? formatUsdc(chain.balance.amount) : undefined,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="withdraw-coin">Coin</FieldLabel>
        <OptionSelect
          id="withdraw-coin"
          value={props.coin}
          options={coins}
          disabled={props.disabled}
          onChange={props.onCoin}
        />
      </Field>
      <Field data-disabled={!props.coin || props.disabled ? true : undefined}>
        <FieldLabel htmlFor="withdraw-network">From network</FieldLabel>
        <OptionSelect
          id="withdraw-network"
          value={props.network}
          options={networks}
          disabled={!props.coin || props.disabled}
          onChange={props.onNetwork}
        />
      </Field>
    </div>
  );
}
