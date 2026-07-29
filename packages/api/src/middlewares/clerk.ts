import type { WebhookEvent } from "@clerk/backend/webhooks";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { createMiddleware } from "hono/factory";

import { unauthorized, unexpectedError } from "../utils/response";

export type ClerkWebhookVariables = {
  clerkWebhookEvent: WebhookEvent;
};

export const clerkWebhookSecret = () =>
  createMiddleware<{ Bindings: Env; Variables: ClerkWebhookVariables }>(async (c, next) => {
    try {
      const event = await verifyWebhook(c.req.raw, {
        signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET,
      }).catch(() => null);
      if (!event) return unauthorized(c, { message: "Invalid webhook signature" });

      c.set("clerkWebhookEvent", event);

      await next();
    } catch {
      return unexpectedError(c);
    }
  });
