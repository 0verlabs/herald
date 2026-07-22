/** Derive a chat title from its first message: first line, capped at 60 chars. */
export function titleFromMessage(message: string) {
  const firstLine = (message.split("\n")[0] ?? "").trim();
  if (firstLine.length === 0) return "New chat";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60).trimEnd()}…` : firstLine;
}
