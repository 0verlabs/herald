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
  { id: "chat-01", title: "Cloudflare Workers cron triggers" },
  { id: "chat-02", title: "Drizzle migrations on D1" },
  { id: "chat-03", title: "Naming a personal AI agent" },
  { id: "chat-04", title: "Turborepo remote caching setup" },
  { id: "chat-05", title: "Explain OAuth PKCE flow" },
  { id: "chat-06", title: "Tailwind v4 theme tokens" },
  { id: "chat-07", title: "Weekend itinerary for Kyoto" },
  { id: "chat-08", title: "Refactor chat message schema" },
  { id: "chat-09", title: "Bun vs Node cold start times" },
  { id: "chat-10", title: "Landing page copy review" },
];
