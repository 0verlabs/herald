import type { UIMessage } from "@tanstack/ai-client";
import { useChat } from "@tanstack/ai-react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@ivanius.ai/ui/components/message-scroller";
import { SidebarTrigger } from "@ivanius.ai/ui/components/sidebar";

import { ChatMessage } from "../../components/chat-message";
import { ChatTitle } from "../../components/chat-title";
import { useChats } from "../../components/chats-provider";
import { Logo } from "../../components/logo";
import { MessageInput } from "../../components/message-input";
import { createChatConnection, getChatScript } from "../../lib/conversations";
import { getMessageText } from "../../lib/message";

export const Route = createFileRoute("/chat/$chatId")({
  component: ChatRoute,
});

function ChatRoute() {
  const { chatId } = Route.useParams();
  // Remount per chat so useChat starts from that chat's scripted messages.
  return <ChatScreen key={chatId} chatId={chatId} />;
}

/**
 * A conversation branch created by editing/retrying the user message at
 * `anchorIndex`. Each snapshot is the conversation tail (from the anchor
 * onward) for one branch; the active branch's tail lives in `messages` and is
 * snapshotted lazily when switching away.
 */
interface BranchEntry {
  anchorIndex: number;
  snapshots: UIMessage[][];
  active: number;
}

function ChatScreen({ chatId }: { chatId: string }) {
  const { chats, renameChat, consumePendingMessage } = useChats();
  const summary = chats.find((chat) => chat.id === chatId);

  const [script] = useState(() => getChatScript(chatId));
  const [initialMessages] = useState(() => script.get());
  const [connection] = useState(() => createChatConnection(script));

  const { messages, sendMessage, setMessages, reload, status } = useChat({
    initialMessages,
    connection,
  });
  const isBusy = status === "submitted" || status === "streaming";

  const [branches, setBranches] = useState<BranchEntry[]>([]);

  // Chats started from the index page carry their first message over.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const pending = consumePendingMessage(chatId);
    if (pending) void sendMessage(pending);
  }, [chatId, consumePendingMessage, sendMessage]);

  /** Replace the conversation from `index` on with a re-sent user message. */
  function createBranch(index: number, text: string) {
    const tail = messages.slice(index);
    setBranches((prev) => {
      // Branches recorded deeper in the replaced tail are no longer reachable.
      const kept = prev.filter((entry) => entry.anchorIndex < index);
      const existing = prev.find((entry) => entry.anchorIndex === index);
      if (!existing) {
        return [...kept, { anchorIndex: index, snapshots: [tail, []], active: 1 }];
      }
      const snapshots = [...existing.snapshots];
      snapshots[existing.active] = tail;
      snapshots.push([]);
      return [...kept, { ...existing, snapshots, active: snapshots.length - 1 }];
    });
    setMessages(messages.slice(0, index));
    void sendMessage(text);
  }

  function switchBranch(index: number, direction: 1 | -1) {
    const entry = branches.find((candidate) => candidate.anchorIndex === index);
    if (!entry) return;
    const target = entry.active + direction;
    if (target < 0 || target >= entry.snapshots.length) return;

    const tail = messages.slice(index);
    setBranches((prev) =>
      prev
        .filter((candidate) => candidate.anchorIndex <= index)
        .map((candidate) =>
          candidate.anchorIndex === index
            ? {
                ...candidate,
                snapshots: candidate.snapshots.map((snapshot, snapshotIndex) =>
                  snapshotIndex === candidate.active ? tail : snapshot
                ),
                active: target,
              }
            : candidate
        )
    );
    setMessages([...messages.slice(0, index), ...(entry.snapshots[target] ?? [])]);
  }

  const lastAssistantId = messages.findLast((message) => message.role === "assistant")?.id;

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger className="md:hidden" />
        <ChatTitle
          title={summary?.title ?? "New chat"}
          onRename={(title) => renameChat(chatId, title)}
        />
      </header>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-8 px-4 py-6">
              {messages.map((message, index) => {
                const entry = branches.find((candidate) => candidate.anchorIndex === index);
                const isLastMessage = index === messages.length - 1;
                return (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatMessage
                      message={message}
                      streaming={isBusy && isLastMessage && message.role === "assistant"}
                      disabled={isBusy}
                      isLast={message.id === lastAssistantId}
                      branch={
                        entry ? { active: entry.active, count: entry.snapshots.length } : undefined
                      }
                      onBranchChange={(direction) => switchBranch(index, direction)}
                      onRetry={
                        message.role === "user"
                          ? () => createBranch(index, getMessageText(message))
                          : () => void reload()
                      }
                      onEditSubmit={(text) => createBranch(index, text)}
                    />
                  </MessageScrollerItem>
                );
              })}
              {status === "submitted" && (
                <MessageScrollerItem messageId="pending-response">
                  <Logo size="sm" className="animate-pulse" />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
        <div className="mx-auto w-full max-w-3xl px-4">
          <MessageInput
            placeholder="Write a message..."
            onSubmit={({ message }) => {
              if (message.length > 0) void sendMessage(message);
            }}
          />
          <p className="py-2 text-center text-xs text-muted-foreground">
            Ivanius can make mistakes. Please double-check responses.
          </p>
        </div>
      </MessageScrollerProvider>
    </div>
  );
}
