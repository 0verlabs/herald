import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@hrld/ui/components/attachment";
import { InputGroupAddon } from "@hrld/ui/components/input-group";
import { FileText, ImageIcon, X } from "lucide-react";

import type { Attachment as DraftAttachment } from "../../types/attachment";
import { formatSize, parseDataUrl } from "../../lib/attachment";

interface MessageInputAttachmentsProps {
  attachments: DraftAttachment[];
  onRemove: (id: string) => void;
}

/** Draft attachment chips; renders nothing while the draft has no files. */
export function MessageInputAttachments({ attachments, onRemove }: MessageInputAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <InputGroupAddon align="block-start" className="px-2 pt-1">
      <AttachmentGroup className="gap-1">
        {attachments.map((attachment) => {
          const parsed = parseDataUrl(attachment.data);
          const isImage = parsed?.mime.startsWith("image/") ?? false;
          return (
            <Attachment key={attachment.id} size="sm">
              <AttachmentMedia variant={isImage ? "image" : "icon"}>
                {isImage ? (
                  <img src={attachment.data} alt="" />
                ) : parsed ? (
                  <FileText />
                ) : (
                  <ImageIcon />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.filename}</AttachmentTitle>
                {parsed && (
                  <AttachmentDescription>{formatSize(parsed.payload)}</AttachmentDescription>
                )}
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() => onRemove(attachment.id)}
                >
                  <X />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          );
        })}
      </AttachmentGroup>
    </InputGroupAddon>
  );
}
