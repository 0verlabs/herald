import { z } from "zod";

export const envSchema = z.object({
  // Databases
  DATABASE_URL: z.url(),
  // Privy
  PRIVY_APP_ID: z.string(),
  PRIVY_APP_SECRET: z.string(),
  PRIVY_WEBHOOK_SIGNING_SECRET: z.string(),
  // Goldsky
  GOLDSKY_WEBHOOK_SECRET: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(Bun.env);
