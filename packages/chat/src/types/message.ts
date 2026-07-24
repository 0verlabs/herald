import { z } from "zod";

import { attachmentSchema } from "./attachment";

/** What the user composed in the input: text plus any attached files. */
export const messageDraftSchema = z.object({
  text: z.string(),
  attachments: z.array(attachmentSchema),
});

export type MessageDraft = z.infer<typeof messageDraftSchema>;
