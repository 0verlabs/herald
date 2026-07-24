import type { UIMessage } from "ai";

/** App-level UIMessage: metadata carries the client-side send timestamp. */
export type ChatUIMessage = UIMessage<{ createdAt?: string }>;

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
 * Reasoning steps of a message. Streamed reasoning arrives as a single
 * reasoning part, so steps are joined with blank lines at the source and
 * split back apart here.
 */
export function getMessageReasoning(message: ChatUIMessage) {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .flatMap((part) => part.text.split("\n\n"))
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}
