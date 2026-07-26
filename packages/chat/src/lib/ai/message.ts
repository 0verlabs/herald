import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { isToolUIPart } from "ai";

/** App-level UIMessage: metadata carries the client-side send timestamp. */
export type ChatUIMessage = UIMessage<{ createdAt?: string }>;

/** Any tool invocation part, statically typed or dynamic. */
export type ChatToolPart = ToolUIPart | DynamicToolUIPart;

/** Tool invocation parts of a message, in stream order. */
export function getMessageToolParts(message: ChatUIMessage) {
  return message.parts.filter((part): part is ChatToolPart => isToolUIPart(part));
}

/**
 * The call is still in flight or waiting on the user. A denied approval is
 * terminal on the client: the response is recorded but the turn is not
 * resumed, so the denial only reaches the backend with the next message.
 */
export function isPendingToolPart(part: ChatToolPart) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
    case "approval-requested":
      return true;
    case "approval-responded":
      return part.approval.approved;
    default:
      return false;
  }
}

export function getMessageText(message: ChatUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** File parts of a message (user attachments echoed back in the transcript). */
export function getMessageFiles(message: ChatUIMessage) {
  return message.parts.filter((part) => part.type === "file");
}

/**
 * Split one reasoning part into display steps. Streamed reasoning arrives as
 * a single reasoning part with steps joined by blank lines at the source, so
 * they are split back apart here.
 */
export function splitReasoningSteps(text: string) {
  return text
    .split("\n\n")
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}
