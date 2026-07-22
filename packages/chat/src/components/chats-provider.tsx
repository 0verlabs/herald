import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { ChatSummary } from "../types/chat";
import { titleFromMessage } from "../lib/chat";
import { chats as initialChats } from "../lib/mock-data";

interface ChatsContextValue {
  chats: ChatSummary[];
  renameChat: (id: string, title: string) => void;
  removeChat: (id: string) => void;
  /** Register a new chat for a first message; returns the new chat id. */
  startChat: (message: string) => string;
  /** One-shot read of the first message a new chat was started with. */
  consumePendingMessage: (id: string) => string | null;
}

const ChatsContext = createContext<ChatsContextValue | null>(null);

export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>(initialChats);
  const pendingMessages = useRef(new Map<string, string>());

  const renameChat = useCallback((id: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === id ? { ...chat, title, updatedAt: new Date() } : chat))
    );
  }, []);

  const removeChat = useCallback((id: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== id));
  }, []);

  const startChat = useCallback((message: string) => {
    const id = `chat-${crypto.randomUUID().slice(0, 8)}`;
    setChats((prev) => [{ id, title: titleFromMessage(message), updatedAt: new Date() }, ...prev]);
    pendingMessages.current.set(id, message);
    return id;
  }, []);

  const consumePendingMessage = useCallback((id: string) => {
    const message = pendingMessages.current.get(id) ?? null;
    pendingMessages.current.delete(id);
    return message;
  }, []);

  const value = useMemo(
    () => ({ chats, renameChat, removeChat, startChat, consumePendingMessage }),
    [chats, renameChat, removeChat, startChat, consumePendingMessage]
  );

  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats() {
  const context = useContext(ChatsContext);
  if (!context) {
    throw new Error("useChats must be used within a ChatsProvider");
  }
  return context;
}
