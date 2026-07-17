export interface ChatSummary {
  id: string;
  title: string;
}

export const currentUser = {
  name: "Lucky Ivanius",
  email: "lucky@ivanius.ai",
  initials: "LI",
  plan: "Pro",
  balance: "$24.50",
};

export const chats: ChatSummary[] = [
  { id: "chat-01", title: "Swap 500 USDC for ETH on Base" },
  { id: "chat-02", title: "Set up an A2A payment channel" },
  { id: "chat-03", title: "Delegate research to a sub-agent" },
  { id: "chat-04", title: "Bridge assets from Arbitrum to Solana" },
  { id: "chat-05", title: "Sign an x402 payment for API access" },
  { id: "chat-06", title: "Approve agent spending allowance" },
  { id: "chat-07", title: "Discover vendor agents via registry" },
  { id: "chat-08", title: "Stake ETH and auto-compound rewards" },
  { id: "chat-09", title: "Escrow contract for agent-to-agent trade" },
  { id: "chat-10", title: "Monitor wallet for large transfers" },
];
