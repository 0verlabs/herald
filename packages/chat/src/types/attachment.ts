import { z } from "zod";

import { DATA_URL_PATTERN } from "../config/attachment";

export const attachmentSchema = z.object({
  id: z.uuidv4(),
  filename: z.string().min(1, "Attachment needs a filename"),
  data: z.string().regex(DATA_URL_PATTERN, "Attachment must be a base64 data URL"),
});

export type Attachment = z.infer<typeof attachmentSchema>;
