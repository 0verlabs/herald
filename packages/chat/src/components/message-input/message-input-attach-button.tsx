import { Paperclip } from "lucide-react";
import { useRef } from "react";

import { InputGroupButton } from "@ivanius.ai/ui/components/input-group";

interface MessageInputAttachButtonProps {
  /** Files the user picked; conversion/storage is the parent's concern. */
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

/** Paperclip button backed by a hidden file input. */
export function MessageInputAttachButton({
  onFilesSelected,
  disabled,
}: MessageInputAttachButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          // Copy out of the live FileList before clearing the input —
          // resetting `value` empties it, and reads downstream are async.
          const selected = Array.from(event.target.files ?? []);
          // Allow re-picking the same file.
          event.target.value = "";
          if (selected.length > 0) {
            onFilesSelected(selected);
          }
        }}
      />
      <InputGroupButton
        size="icon-sm"
        aria-label="Attach files"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip />
      </InputGroupButton>
    </>
  );
}
