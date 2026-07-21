import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUp, ChevronDown, FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { useId, useRef } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@ivanius.ai/ui/components/attachment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ivanius.ai/ui/components/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@ivanius.ai/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@ivanius.ai/ui/components/input-group";
import { cn } from "@ivanius.ai/ui/lib/utils";

import type { Attachment as MessageAttachment } from "../types/attachment";
import type { ModelId } from "../types/model";
import { MAX_ATTACHMENTS } from "../config/attachment";
import { DEFAULT_MODEL, MODEL_IDS, MODELS } from "../config/model";
import { formatSize, parseDataUrl, readAsDataUrl } from "../lib/attachment";
import { attachmentSchema } from "../types/attachment";
import { modelIdSchema } from "../types/model";
import { ModelProviderLogo } from "./model-provider-logo";

export const messageInputSchema = z.object({
  message: z.string().trim(),
  model: modelIdSchema,
  attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS, {
    message: `Attach at most ${MAX_ATTACHMENTS} files`,
  }),
});

export type MessageInputValues = z.infer<typeof messageInputSchema>;

interface MessageInputProps
  extends Omit<React.ComponentProps<"form">, "onSubmit" | "defaultValue"> {
  initialValues?: Partial<MessageInputValues>;
  onSubmit?: (values: MessageInputValues) => void | Promise<void>;
  placeholder?: string;
}

export function MessageInput({
  initialValues,
  onSubmit,
  placeholder = "Ask anything",
  className,
  ...props
}: MessageInputProps) {
  const messageId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<MessageInputValues>({
    resolver: zodResolver(messageInputSchema),
    defaultValues: {
      message: initialValues?.message ?? "",
      model: initialValues?.model ?? DEFAULT_MODEL,
      attachments: initialValues?.attachments ?? [],
    },
  });

  const { control, formState, getValues, handleSubmit, reset, setValue } = form;
  const attachments = useWatch({ control, name: "attachments" });
  const message = useWatch({ control, name: "message" });

  const canSubmit = message.trim().length > 0 || attachments.length > 0;

  const attachmentsError = formState.errors.attachments;
  const errors = [attachmentsError?.root ?? attachmentsError];

  async function addFiles(files: File[]) {
    const added: MessageAttachment[] = [];
    for (const file of files) {
      added.push({
        id: crypto.randomUUID(),
        filename: file.name,
        data: await readAsDataUrl(file),
      });
    }
    setValue("attachments", [...getValues("attachments"), ...added], {
      shouldValidate: true,
    });
  }

  function removeAttachment(id: string) {
    setValue(
      "attachments",
      getValues("attachments").filter((attachment) => attachment.id !== id),
      { shouldValidate: true }
    );
  }

  async function submit(values: MessageInputValues) {
    // Nothing to send — stay quiet rather than surfacing an error.
    if (values.message.length === 0 && values.attachments.length === 0) return;

    await onSubmit?.(values);
    // Keep the chosen model, clear what was sent.
    reset({ message: "", model: values.model, attachments: [] });
  }

  return (
    <form className={cn("w-full", className)} onSubmit={handleSubmit(submit)} {...props}>
      <FieldGroup>
        <Field data-invalid={formState.errors.message ? true : undefined}>
          <FieldLabel htmlFor={messageId} className="sr-only">
            Message
          </FieldLabel>
          {/* InputGroup dims itself whenever *any* descendant is disabled; the
              send button is disabled on empty input, so opt out of that. */}
          <InputGroup className="rounded-2xl bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card">
            {attachments.length > 0 && (
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
                            <AttachmentDescription>
                              {formatSize(parsed.payload)}
                            </AttachmentDescription>
                          )}
                        </AttachmentContent>
                        <AttachmentActions>
                          <AttachmentAction
                            aria-label={`Remove ${attachment.filename}`}
                            onClick={() => removeAttachment(attachment.id)}
                          >
                            <X />
                          </AttachmentAction>
                        </AttachmentActions>
                      </Attachment>
                    );
                  })}
                </AttachmentGroup>
              </InputGroupAddon>
            )}

            <Controller
              control={control}
              name="message"
              render={({ field, fieldState }) => (
                <InputGroupTextarea
                  {...field}
                  id={messageId}
                  placeholder={placeholder}
                  aria-invalid={fieldState.invalid}
                  className="max-h-48 min-h-16 px-4 pt-3.5"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSubmit(submit)();
                    }
                  }}
                />
              )}
            />

            <InputGroupAddon align="block-end" className="gap-1 px-2 pb-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  // Copy out of the live FileList before clearing the input —
                  // resetting `value` empties it, and the reads below are async.
                  const selected = Array.from(event.target.files ?? []);
                  // Allow re-picking the same file.
                  event.target.value = "";
                  if (selected.length > 0) {
                    void addFiles(selected);
                  }
                }}
              />
              <InputGroupButton
                size="icon-sm"
                aria-label="Attach files"
                disabled={formState.isSubmitting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip />
              </InputGroupButton>

              <Controller
                control={control}
                name="model"
                render={({ field }) => (
                  // Non-modal: selecting re-renders this subtree mid-close, which
                  // strands the modal backdrop and blocks clicks on the whole page.
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger
                      disabled={formState.isSubmitting}
                      render={<InputGroupButton size="sm" />}
                    >
                      <ModelProviderLogo
                        provider={MODELS[field.value].provider}
                        className="text-foreground"
                      />
                      {MODELS[field.value].label}
                      <ChevronDown />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-auto min-w-52 max-h-50">
                      <DropdownMenuRadioGroup
                        value={field.value}
                        onValueChange={(value) => field.onChange(value as ModelId)}
                      >
                        {MODEL_IDS.map((id) => (
                          <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                            <ModelProviderLogo
                              provider={MODELS[id].provider}
                              className="text-foreground"
                            />
                            {MODELS[id].label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              />

              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label="Send message"
                disabled={formState.isSubmitting || !canSubmit}
                className="ml-auto rounded-full"
              >
                <ArrowUp />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError errors={errors} />
        </Field>
      </FieldGroup>
    </form>
  );
}
