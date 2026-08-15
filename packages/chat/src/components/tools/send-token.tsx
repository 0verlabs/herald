import { Send } from "lucide-react";

import type { ToolRenderer } from "../../lib/ai/tool-renderers";

/** Mirrors packages/agent/src/tools/send-token.ts. */
interface SendTokenInput {
  chain: "0g-testnet";
  to: string;
  amount: string;
  token?: "USDC";
}

type SendTokenOutput = {
  address: string;
  chain: string;
  txHash: string;
  explorerUrl: string;
} | null;

function formatTransfer(input: SendTokenInput | undefined) {
  if (input?.to === undefined || input.amount === undefined) return null;
  // No token means a native transfer. The chain is always named: an approval prompt that can't
  // distinguish testnet from mainnet is not an approval.
  return `${input.amount.toLocaleString()} ${input.token ?? "0G"} → ${input.to} on ${input.chain}`;
}

export const sendTokenToolRenderer: ToolRenderer<SendTokenInput, SendTokenOutput> = {
  icon: Send,
  label: () => "Send token",
  renderSummary: (input) => formatTransfer(input),
  renderInput: (input) => {
    const transfer = formatTransfer(input);
    if (!transfer) return null;
    return <p className="font-mono text-sm">{transfer}</p>;
  },
  renderOutput: (output) => {
    if (!output?.txHash) return <p className="text-destructive text-sm">Transaction failed.</p>;
    return (
      <a
        href={output.explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="truncate font-mono text-sm underline"
      >
        {output.txHash}
      </a>
    );
  },
  approvalMessage: (input) => {
    const transfer = formatTransfer(input);
    return transfer ? `Send ${transfer}?` : "Send this token transfer?";
  },
};
