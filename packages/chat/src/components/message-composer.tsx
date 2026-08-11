import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Field, FieldError, FieldGroup } from "@0verlabs/herald-ui/components/field";
import { InputGroup } from "@0verlabs/herald-ui/components/input-group";
import { cn } from "@0verlabs/herald-ui/lib/utils";

import type { Attachment } from "../types/attachment";
import type { MessageDraft } from "../types/message";
import type { ModelId } from "../types/model";
import { MAX_ATTACHMENTS } from "../config/attachment";
import { readAsDataUrl } from "../lib/attachment";
import { attachmentSchema } from "../types/attachment";
import { MessageInputAttachButton } from "./message-input/message-input-attach-button";
import { MessageInputAttachments } from "./message-input/message-input-attachments";
import { MessageInputSubmit } from "./message-input/message-input-submit";
import { MessageInputTextarea } from "./message-input/message-input-textarea";
import { MessageInputToolbar } from "./message-input/message-input-toolbar";
import { ModelSelect } from "./model-select";

export const messageDraftFormSchema = z.object({
  text: z.string(),
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS, {
    message: `Attach at most ${MAX_ATTACHMENTS} files`,
  }),
});

interface MessageComposerProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  onSend: (draft: MessageDraft) => void | Promise<void>;
  placeholder?: string;
}

/**
 * Owns the draft form and wires the controlled message-input atoms together.
 * The model is controlled by the parent so other surfaces (retry, regenerate)
 * share the same selection.
 */
export function MessageComposer({
  model,
  onModelChange,
  onSend,
  placeholder,
  className,
  ...props
}: MessageComposerProps) {
  const { control, formState, getValues, handleSubmit, reset, setValue } = useForm<MessageDraft>({
    resolver: zodResolver(messageDraftFormSchema),
    defaultValues: { text: "", attachments: [] },
  });
  const attachments = useWatch({ control, name: "attachments" });
  const text = useWatch({ control, name: "text" });

  const canSubmit = text.trim().length > 0 || attachments.length > 0;

  const attachmentsError = formState.errors.attachments;
  const errors = [attachmentsError?.root ?? attachmentsError];

  const setAttachments = (next: Attachment[]) =>
    setValue("attachments", next, { shouldValidate: true });

  async function addFiles(files: File[]) {
    const added: Attachment[] = [];
    for (const file of files) {
      added.push({
        id: crypto.randomUUID(),
        filename: file.name,
        data: await readAsDataUrl(file),
      });
    }
    setAttachments([...getValues("attachments"), ...added]);
  }

  const submit = handleSubmit(async (values) => {
    const draft = { text: values.text.trim(), attachments: values.attachments };
    // Nothing to send — stay quiet rather than surfacing an error.
    if (draft.text.length === 0 && draft.attachments.length === 0) return;

    await onSend(draft);
    reset({ text: "", attachments: [] });
  });

  return (
    <form className={cn("w-full", className)} onSubmit={submit} {...props}>
      <FieldGroup>
        <Field>
          <InputGroup className="rounded-2xl bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card">
            <MessageInputAttachments
              attachments={attachments}
              onRemove={(id) => setAttachments(getValues("attachments").filter((a) => a.id !== id))}
            />
            <MessageInputTextarea
              value={text}
              onValueChange={(value) => setValue("text", value)}
              onSend={() => void submit()}
              placeholder={placeholder}
            />
            <MessageInputToolbar>
              <MessageInputAttachButton
                disabled={formState.isSubmitting}
                onFilesSelected={(files) => void addFiles(files)}
              />
              <ModelSelect
                value={model}
                onValueChange={onModelChange}
                disabled={formState.isSubmitting}
              />
              <MessageInputSubmit disabled={formState.isSubmitting || !canSubmit} />
            </MessageInputToolbar>
          </InputGroup>
          <FieldError errors={errors} />
        </Field>
      </FieldGroup>
    </form>
  );
}
