import { z } from "zod";

export const envSchema = z.object({
  // Databases
  DATABASE_URL: z.url(),
  // Chain RPCs, keyed by caip2.
  RPC_URL_0G: z.url().optional(),
  RPC_URL_0G_TESTNET: z.url().optional(),
  // Privy
  PRIVY_APP_ID: z.string(),
  PRIVY_APP_SECRET: z.string(),
  PRIVY_WEBHOOK_SIGNING_SECRET: z.string(),
  PRIVY_AUTHORIZATION_ID: z.string(),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string(),
  // Clerk
  CLERK_PUBLISHABLE_KEY: z.string(),
  CLERK_SECRET_KEY: z.string(),
  // LLM API Urls
  ANTHROPIC_API_URL: z.url(),
  OPENAI_API_URL: z.url(),
  DEEPSEEK_API_URL: z.url(),
  MOONSHOTAI_API_URL: z.url(),
  MINIMAX_API_URL: z.url(),
  ALIBABA_API_URL: z.url(),
  ZHIPUAI_API_URL: z.url(),
  // LLM API Keys
  ANTHROPIC_API_KEY: z.string(),
  OPENAI_API_KEY: z.string(),
  DEEPSEEK_API_KEY: z.string(),
  MOONSHOTAI_API_KEY: z.string(),
  MINIMAX_API_KEY: z.string(),
  ALIBABA_API_KEY: z.string(),
  ZHIPUAI_API_KEY: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(Bun.env);
