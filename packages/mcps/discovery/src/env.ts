import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  INDEXER_DATABASE_SCHEMA: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(Bun.env);
