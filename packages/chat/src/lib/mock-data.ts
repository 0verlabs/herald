import { subDays, subHours } from "date-fns";

import type { ChatSummary } from "../types/chat";

const daysAgo = (days: number) => subDays(new Date(), days);

export const currentUser = {
  name: "Lucky Ivanius",
  email: "lucky@ivanius.ai",
  initials: "LI",
  plan: "Pro",
  balance: "$24.50",
};

export const chats: ChatSummary[] = [
  { id: "chat-01", title: "Swap 500 USDC for ETH on Base", updatedAt: subHours(new Date(), 3) },
  { id: "chat-02", title: "Set up an A2A payment channel", updatedAt: daysAgo(1) },
  { id: "chat-03", title: "Delegate research to a sub-agent", updatedAt: daysAgo(1) },
  { id: "chat-04", title: "Bridge assets from Arbitrum to Solana", updatedAt: daysAgo(2) },
  { id: "chat-05", title: "Sign an x402 payment for API access", updatedAt: daysAgo(3) },
  { id: "chat-06", title: "Approve agent spending allowance", updatedAt: daysAgo(5) },
  { id: "chat-07", title: "Discover vendor agents via registry", updatedAt: daysAgo(9) },
  { id: "chat-08", title: "Stake ETH and auto-compound rewards", updatedAt: daysAgo(18) },
  { id: "chat-09", title: "Escrow contract for agent-to-agent trade", updatedAt: daysAgo(42) },
  { id: "chat-10", title: "Monitor wallet for large transfers", updatedAt: daysAgo(96) },
];
