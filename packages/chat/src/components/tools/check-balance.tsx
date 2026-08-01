import { Wallet } from "lucide-react";

import type { ToolRenderer } from "../../lib/ai/tool-renderers";

/** Mirrors packages/api/src/lib/tools/check-balance.ts. */
interface CheckBalanceOutput {
  token: {
    name: string;
    symbol: string;
    tokenAddress?: string;
  };
  amount: string;
}

export const checkBalanceToolRenderer: ToolRenderer<Record<string, never>, CheckBalanceOutput[]> = {
  icon: Wallet,
  label: () => "Check balance",
  renderOutput: (output) => {
    if (!output.length) return <p className="text-muted-foreground text-sm">No balances found.</p>;
    return (
      <ul className="flex flex-col gap-1">
        {output.map(({ token, amount }) => (
          <li
            key={token.tokenAddress ?? token.symbol}
            className="flex items-center justify-between gap-2 font-mono text-sm tabular-nums"
          >
            <span className="text-muted-foreground">{token.symbol}</span>
            <span className="font-semibold">{amount}</span>
          </li>
        ))}
      </ul>
    );
  },
};
