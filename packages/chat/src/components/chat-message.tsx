import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, Copy, FileText, Info, Pencil, RefreshCcw } from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@ivanius.ai/ui/components/attachment";
import { Bubble, BubbleContent } from "@ivanius.ai/ui/components/bubble";
import { Button } from "@ivanius.ai/ui/components/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ivanius.ai/ui/components/field";
import { Message, MessageContent, MessageFooter } from "@ivanius.ai/ui/components/message";
import { Textarea } from "@ivanius.ai/ui/components/textarea";
import { cn } from "@ivanius.ai/ui/lib/utils";

import type { ChatUIMessage } from "../lib/ai/message";
import { getMessageFiles, getMessageReasoning, getMessageText } from "../lib/ai/message";
import { copyText } from "../lib/clipboard";
import { formatTime } from "../lib/datetime";
import { ChatReasoning } from "./chat-reasoning";
import { Markdown } from "./markdown";

export interface BranchInfo {
  active: number;
  count: number;
}

interface ChatMessageProps {
  message: ChatUIMessage;
  /** This message is the assistant turn currently streaming in. */
  streaming?: boolean;
  /** Actions that mutate the conversation are unavailable (a response is running). */
  disabled?: boolean;
  /** Last assistant message gets a persistent footer and a retry action. */
  isLast?: boolean;
  branch?: BranchInfo;
  onBranchChange?: (direction: 1 | -1) => void;
  /** User messages: re-send this text as a new branch. Assistant: regenerate. */
  onRetry?: () => void;
  onEditSubmit?: (text: string) => void;
}

export function ChatMessage({
  message,
  streaming = false,
  disabled = false,
  isLast = false,
  branch,
  onBranchChange,
  onRetry,
  onEditSubmit,
}: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <UserMessage
        message={message}
        disabled={disabled}
        branch={branch}
        onBranchChange={onBranchChange}
        onRetry={onRetry}
        onEditSubmit={onEditSubmit}
      />
    );
  }
  return (
    <AssistantMessage message={message} streaming={streaming} isLast={isLast} onRetry={onRetry} />
  );
}

function UserMessage({
  message,
  disabled,
  branch,
  onBranchChange,
  onRetry,
  onEditSubmit,
}: Pick<
  ChatMessageProps,
  "message" | "disabled" | "branch" | "onBranchChange" | "onRetry" | "onEditSubmit"
>) {
  const [editing, setEditing] = useState(false);
  const text = getMessageText(message);
  const files = getMessageFiles(message);

  if (editing) {
    return (
      <Message align="end">
        <MessageContent>
          <MessageEditForm
            defaultValue={text}
            onCancel={() => setEditing(false)}
            onSubmit={(edited) => {
              setEditing(false);
              onEditSubmit?.(edited);
            }}
          />
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message align="end">
      <MessageContent>
        {files.length > 0 && (
          <AttachmentGroup className="justify-end gap-1">
            {files.map((file) => {
              const isImage = file.mediaType.startsWith("image/");
              return (
                <Attachment key={file.url} size="sm">
                  <AttachmentMedia variant={isImage ? "image" : "icon"}>
                    {isImage ? <img src={file.url} alt="" /> : <FileText />}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{file.filename ?? "file"}</AttachmentTitle>
                  </AttachmentContent>
                </Attachment>
              );
            })}
          </AttachmentGroup>
        )}
        {text.length > 0 && (
          <Bubble variant="muted" align="end">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        )}
        <MessageFooter
          className={cn(
            "gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100",
            branch && "opacity-100"
          )}
        >
          {message.metadata?.createdAt && (
            <span className="mr-1">{formatTime(new Date(message.metadata.createdAt))}</span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Retry message"
            disabled={disabled}
            onClick={onRetry}
          >
            <RefreshCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit message"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy message"
            onClick={() => copyText(text)}
          >
            <Copy />
          </Button>
          {branch && branch.count > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Previous branch"
                disabled={disabled || branch.active === 0}
                onClick={() => onBranchChange?.(-1)}
              >
                <ChevronLeft />
              </Button>
              <span className="tabular-nums">
                {branch.active + 1}/{branch.count}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Next branch"
                disabled={disabled || branch.active === branch.count - 1}
                onClick={() => onBranchChange?.(1)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({
  message,
  streaming,
  isLast,
  onRetry,
}: Pick<ChatMessageProps, "message" | "onRetry"> & { streaming: boolean; isLast: boolean }) {
  const text = getMessageText(message);
  const reasoning = getMessageReasoning(message);

  return (
    <Message align="start">
      <MessageContent className="gap-4">
        {reasoning.length > 0 && (
          <ChatReasoning steps={reasoning} streaming={streaming && text.length === 0} />
        )}
        {text.length > 0 && (
          <Bubble variant="ghost" className="w-full max-w-full">
            <BubbleContent className="w-full">
              <Markdown>{text}</Markdown>
            </BubbleContent>
          </Bubble>
        )}
        {!streaming && (
          <MessageFooter
            className={cn(
              "-ml-1.5 gap-0.5",
              !isLast &&
                "opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
            )}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy response"
              onClick={() => copyText(text)}
            >
              <Copy />
            </Button>
            {isLast && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Regenerate response"
                onClick={onRetry}
              >
                <RefreshCcw />
              </Button>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

const editMessageSchema = z.object({
  message: z.string().trim().min(1),
});

type EditMessageValues = z.infer<typeof editMessageSchema>;

function MessageEditForm({
  defaultValue,
  onCancel,
  onSubmit,
}: {
  defaultValue: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const messageId = useId();
  const { control, formState, handleSubmit } = useForm<EditMessageValues>({
    resolver: zodResolver(editMessageSchema),
    defaultValues: { message: defaultValue },
  });
  const message = useWatch({ control, name: "message" });

  const canSave = formState.isDirty && message.trim().length > 0;
  const submit = handleSubmit((values) => onSubmit(values.message));

  return (
    <form className="w-full" onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={messageId} className="sr-only">
            Edit message
          </FieldLabel>
          <Controller
            control={control}
            name="message"
            render={({ field }) => (
              <Textarea
                {...field}
                id={messageId}
                autoFocus
                className="min-h-24 rounded-xl"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancel();
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
            )}
          />
          <div className="flex items-start justify-between gap-4">
            <FieldDescription className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Editing this message will create a new conversation branch. You can switch between
              branches using the arrow navigation buttons.
            </FieldDescription>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!canSave}>
                Save
              </Button>
            </div>
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}
