import type { UIMessage } from "ai";
import { clerkMiddleware, getAuth } from "@clerk/hono";
import { zValidator } from "@hono/zod-validator";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { env } from "../env";
import { createModel } from "../lib/adapters";
import { providerEnv } from "../lib/env";
import { DEFAULT_MODEL, MODEL_PROVIDERS, modelIdSchema } from "../lib/models";
import { privy } from "../middlewares/privy";
import { createCheckBalanceTools } from "../tools/check-balance";
import { createGetWalletsTools } from "../tools/get-wallets";
import { createSendTokenTools } from "../tools/send-token";
import { unauthorized, unexpectedError } from "../utils/response";

// UIMessage wire shape as sent by the AI SDK chat transport. Extra fields
// (metadata, part payloads) pass through untouched — `convertToModelMessages`
// owns the richer part types.
const messageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.looseObject({ type: z.string() })),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  model: modelIdSchema.default(DEFAULT_MODEL),
});

const SYSTEM_PROMPT = "You are a helpful assistant.";

const chat = new Hono<{ Variables: GlobalVariables }>().post(
  "/",
  clerkMiddleware({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  }),
  privy({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }),
  zValidator("json", chatRequestSchema),
  async (c) => {
    const { userId } = getAuth(c);
    if (!userId) return unauthorized(c);

    const { messages, model } = c.req.valid("json");

    const modelOptions = providerEnv(env, MODEL_PROVIDERS[model]);
    if (!modelOptions) {
      console.error(`No providers for ${model} model`);
      return unexpectedError(c);
    }

    const db = c.var.db;
    const privy = c.var.privyClient;

    const tools = {
      get_wallets: createGetWalletsTools({ db, userId }),
      check_balance: createCheckBalanceTools({ db, userId }),
      send_token: createSendTokenTools({
        db,
        privy,
        userId,
        authorizationId: env.PRIVY_AUTHORIZATION_ID,
        authorizationPrivateKey: env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
      }),
    };

    const result = streamText({
      model: createModel(model, modelOptions),
      instructions: SYSTEM_PROMPT,
      // The schema validates the wire shape; `convertToModelMessages` owns
      // the richer UIMessage part types (tool calls, approvals, reasoning).
      messages: await convertToModelMessages(messages as UIMessage[], { tools }),
      tools,
      stopWhen: isStepCount(5),
      abortSignal: c.req.raw.signal,
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  }
);

export default chat;
