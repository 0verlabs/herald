import { z } from "zod";

export const envSchema = z.object({
  BASE_API_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(Bun.env);
