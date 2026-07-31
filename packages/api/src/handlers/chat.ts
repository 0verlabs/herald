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

import { createModel } from "../lib/adapters";
import { providerEnv } from "../lib/env";
import { DEFAULT_MODEL, MODEL_PROVIDERS, modelIdSchema } from "../lib/models";
import { createCalculatorTools } from "../lib/tools/calculator";
import { unauthorized } from "../utils/response";

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

const SYSTEM_PROMPT =
  "You are a helpful assistant. Use the calculation tools for any arithmetic instead of computing it yourself.";

const chat = new Hono<{ Bindings: Env }>().post(
  "/",
  (c, next) =>
    clerkMiddleware({
      publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      secretKey: c.env.CLERK_SECRET_KEY,
    })(c, next),
  zValidator("json", chatRequestSchema),
  async (c) => {
    const { userId } = getAuth(c);
    if (!userId) return unauthorized(c);

    const { messages, model } = c.req.valid("json");

    const tools = createCalculatorTools();
    const result = streamText({
      model: createModel(model, providerEnv(c.env, MODEL_PROVIDERS[model])),
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
