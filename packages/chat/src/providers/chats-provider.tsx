import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { ChatSummary } from "../types/chat";
import type { MessageDraft } from "../types/message";
import type { ModelId } from "../types/model";
import { titleFromMessage } from "../lib/chat";

/** Everything needed to fire a chat's first request once its route mounts. */
export interface PendingMessage {
  draft: MessageDraft;
  model: ModelId;
}

interface ChatsContextValue {
  chats: ChatSummary[];
  renameChat: (id: string, title: string) => void;
  removeChat: (id: string) => void;
  /** Register a new chat for a first message; returns the new chat id. */
  startChat: (pending: PendingMessage) => string;
  /** One-shot read of the message a new chat was started with. */
  consumePendingMessage: (id: string) => PendingMessage | null;
}

const ChatsContext = createContext<ChatsContextValue | null>(null);

export function ChatsProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const pendingMessages = useRef(new Map<string, PendingMessage>());

  const renameChat = useCallback((id: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === id ? { ...chat, title, updatedAt: new Date() } : chat))
    );
  }, []);

  const removeChat = useCallback((id: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== id));
  }, []);

  const startChat = useCallback((pending: PendingMessage) => {
    const id = crypto.randomUUID();
    setChats((prev) => [
      { id, title: titleFromMessage(pending.draft.text), updatedAt: new Date() },
      ...prev,
    ]);
    pendingMessages.current.set(id, pending);
    return id;
  }, []);

  const consumePendingMessage = useCallback((id: string) => {
    const pending = pendingMessages.current.get(id) ?? null;
    pendingMessages.current.delete(id);
    return pending;
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
