import { useChat } from "@ai-sdk/react";
import { useAuth, useClerk } from "@clerk/react";
import { createFileRoute } from "@tanstack/react-router";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useEffect, useRef, useState } from "react";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@0verlabs/herald-ui/components/message-scroller";
import { SidebarTrigger } from "@0verlabs/herald-ui/components/sidebar";

import type { ChatUIMessage } from "../../lib/ai/message";
import type { MessageDraft } from "../../types/message";
import type { ModelId } from "../../types/model";
import { ChatMessage } from "../../components/chat-message";
import { ChatTitle } from "../../components/chat-title";
import { Logo } from "../../components/logo";
import { MessageComposer } from "../../components/message-composer";
import { filePartsToAttachments } from "../../lib/ai/attachment";
import { getMessageFiles, getMessageText, getMessageToolParts } from "../../lib/ai/message";
import { draftToSendContent } from "../../lib/ai/send";
import { useChats } from "../../providers/chats-provider";
import { useModel } from "../../providers/model-provider";

export const Route = createFileRoute("/chat/$chatId")({
  component: ChatRoute,
});

function ChatRoute() {
  const { chatId } = Route.useParams();
  // Remount per chat so useChat starts from that chat's messages.
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
  snapshots: ChatUIMessage[][];
  active: number;
}

function ChatScreen({ chatId }: { chatId: string }) {
  const { chats, renameChat, consumePendingMessage } = useChats();
  const summary = chats.find((chat) => chat.id === chatId);

  const [transport] = useState(() => new DefaultChatTransport<ChatUIMessage>({ api: "/api/chat" }));
  const { model, setModel } = useModel();

  const { openSignIn } = useClerk();
  const { getToken } = useAuth();

  const { messages, sendMessage, setMessages, regenerate, status, addToolApprovalResponse } =
    useChat<ChatUIMessage>({
      transport,
      // Resume the turn once every tool call has a result or every approval
      // request has been answered — unless anything was denied: a denial
      // stops the turn and leaves the user in control of the next message.
      sendAutomaticallyWhen: (options) => {
        const last = options.messages.at(-1);
        if (last?.role !== "assistant") return false;
        const denied = getMessageToolParts(last).some(
          (part) => part.state === "approval-responded" && !part.approval.approved
        );
        if (denied) return false;
        return (
          lastAssistantMessageIsCompleteWithToolCalls(options) ||
          lastAssistantMessageIsCompleteWithApprovalResponses(options)
        );
      },
    });
  const isBusy = status === "submitted" || status === "streaming";

  async function respondToApproval(approvalId: string, approved: boolean) {
    const token = await getToken();
    if (!token) throw openSignIn();

    void addToolApprovalResponse({
      id: approvalId,
      approved,
      options: { body: { model }, headers: { Authorization: `Bearer ${token}` } },
    });
  }

  async function send(draft: MessageDraft, sendModel: ModelId = model) {
    const token = await getToken();
    if (!token) throw openSignIn();

    const content = draftToSendContent(draft);
    if (!content) return;

    void sendMessage(
      { ...content, metadata: { createdAt: new Date().toISOString() } },
      { body: { model: sendModel }, headers: { Authorization: `Bearer ${token}` } }
    );
  }

  const [branches, setBranches] = useState<BranchEntry[]>([]);

  // Chats started from the index page carry their first message over.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const pending = consumePendingMessage(chatId);
    if (pending) send(pending.draft, pending.model);
  });

  /** Replace the conversation from `index` on with a re-sent user message. */
  function createBranch(index: number, draft: MessageDraft) {
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
    send(draft);
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
          <MessageScrollerViewport tabIndex={-1}>
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
                          ? () =>
                              createBranch(index, {
                                text: getMessageText(message),
                                attachments: filePartsToAttachments(getMessageFiles(message)),
                              })
                          : () => void regenerate({ body: { model } })
                      }
                      onEditSubmit={(text) => createBranch(index, { text, attachments: [] })}
                      onApproval={respondToApproval}
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
          <MessageComposer
            placeholder="Write a message..."
            model={model}
            onModelChange={setModel}
            onSend={(draft) => send(draft)}
          />
          <p className="py-2 text-center text-xs text-muted-foreground">
            Herald can make mistakes. Please double-check responses.
          </p>
        </div>
      </MessageScrollerProvider>
    </div>
  );
}
