import type { UIMessage } from "@tanstack/ai-client";

export function getMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("");
}

/**
 * Reasoning steps of a message. Streamed reasoning arrives as a single
 * thinking part, so steps are joined with blank lines at the source and
 * split back apart here.
 */
export function getMessageReasoning(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "thinking")
    .flatMap((part) => part.content.split("\n\n"))
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}
