import { z } from "zod";

// Herald's curated tag list used for marketplace filtering. Agents carry
// free-text tags; filtering by "others" matches tags outside this list.
export const tags = ["finance", "productivity", "developer-tools", "writing", "research"] as const;

export const tagSchema = z.enum(tags);
export type Tag = z.infer<typeof tagSchema>;
