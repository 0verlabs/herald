import { Hono } from "hono";

import type { ClerkWebhookVariables } from "../middlewares/clerk";
import { clerkWebhookSecret } from "../middlewares/clerk";
import { ok } from "../utils/response";

const auth = new Hono<{ Bindings: Env; Variables: ClerkWebhookVariables }>().post(
  "/webhook",
  clerkWebhookSecret(),
  async (c) => {
    const event = c.get("clerkWebhookEvent");

    if (event.type !== "user.created") {
      return ok(c);
    }

    // const db = createDb(c.env.DB);
    // await db.insert(userWallets).values({ userId: event.data.id }).onConflictDoNothing();

    return ok(c);
  }
);

export default auth;
