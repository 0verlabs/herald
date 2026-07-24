import type { FileUIPart } from "ai";

import type { MessageDraft } from "../../types/message";
import { toFileParts } from "./attachment";

/**
 * `sendMessage` content for a draft. The AI SDK pushes an empty text part
 * when `text` is present but blank, so each field is included only when it
 * carries something; `null` means there is nothing to send.
 */
export type SendContent = { text: string; files?: FileUIPart[] } | { files: FileUIPart[] };

export function draftToSendContent(draft: MessageDraft): SendContent | null {
  const text = draft.text.trim();
  const files = toFileParts(draft.attachments);
  if (text.length > 0) {
    return files.length > 0 ? { text, files } : { text };
  }
  return files.length > 0 ? { files } : null;
}
