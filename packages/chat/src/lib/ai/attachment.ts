import type { FileUIPart } from "ai";

import type { Attachment } from "../../types/attachment";
import { parseDataUrl } from "../attachment";

/** Attachments as AI SDK file parts, ready for `sendMessage`. */
export function toFileParts(attachments: Attachment[]): FileUIPart[] {
  return attachments.map((attachment) => ({
    type: "file",
    mediaType: parseDataUrl(attachment.data)?.mime ?? "application/octet-stream",
    filename: attachment.filename,
    url: attachment.data,
  }));
}

/**
 * File parts back into draft attachments (for retrying a sent message).
 * Lossless because `toFileParts` keeps the data URL in `url`.
 */
export function filePartsToAttachments(parts: FileUIPart[]): Attachment[] {
  return parts.map((part) => ({
    id: crypto.randomUUID(),
    filename: part.filename ?? "file",
    data: part.url,
  }));
}
