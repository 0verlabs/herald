import type { UIMessage } from "ai";
import { zValidator } from "@hono/zod-validator";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createModel } from "./adapters";
import { providerEnv } from "./env";
import { DEFAULT_MODEL, MODEL_PROVIDERS, modelIdSchema } from "./models";
import { createCalculatorTools } from "./tools/calculator";

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

const app = new Hono<{ Bindings: Env }>()
  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal Server Error" }, 500);
  })
  .post("/chat", zValidator("json", chatRequestSchema), async (c) => {
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
  });

export type AppType = typeof app;

export default app;
