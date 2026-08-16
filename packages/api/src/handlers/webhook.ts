import type { PrivyClient } from "@privy-io/node";
import { zValidator } from "@hono/zod-validator";
import { userWallets } from "@hrld/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { env } from "../env";
import { privy } from "../middlewares/privy";
import { badRequest, ok } from "../utils/response";

const privyWebhookHeadersSchema = z.object({
  "svix-id": z.string(),
  "svix-signature": z.string(),
  "svix-timestamp": z.string(),
});

const webhook = new Hono<{ Variables: GlobalVariables }>().post(
  "/privy",
  privy({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
    webhookSigningSecret: env.PRIVY_WEBHOOK_SIGNING_SECRET,
  }),
  zValidator("header", privyWebhookHeadersSchema, ({ success }, c) => {
    if (!success)
      return badRequest(c, { code: "invalid_signature", message: "Invalid webhook signature" });
  }),
  async (c) => {
    const privy = c.var.privyClient;

    // The raw body, not the parsed object — re-serializing would break the
    // signature.
    const payload = await c.req.text();
    const headers = c.req.valid("header");

    const verifiedPayload = verifyPayload(privy, payload, headers);
    if (!verifiedPayload)
      return badRequest(c, { code: "invalid_signature", message: "Invalid webhook signature" });

    switch (verifiedPayload.type) {
      case "user.wallet_created": {
        const db = c.var.db;

        const { user, wallet } = verifiedPayload;

        const auth = user.linked_accounts.find((account) => account.type === "custom_auth");
        if (!auth)
          return badRequest(c, {
            code: "invalid_user_auth",
            message: "Invalid user authentication method",
          });

        const userId = auth.custom_user_id;
        const network = wallet.chain_type === "ethereum" ? "evm" : wallet.chain_type;

        const [existingUserWallet] = await db
          .select({ userId: userWallets.user_id })
          .from(userWallets)
          .where(and(eq(userWallets.user_id, userId), eq(userWallets.network, network)));
        if (existingUserWallet) return ok(c);

        await db.insert(userWallets).values({
          user_id: userId,
          network,
          wallet_address: wallet.address,
        });

        break;
      }
      default:
        break;
    }

    return ok(c);
  }
);

export default webhook;

// `verify` throws on a signature mismatch, a stale timestamp or an unparseable
// body — all of which are the caller's fault, not ours.
function verifyPayload(
  privy: PrivyClient,
  payload: string,
  headers: z.infer<typeof privyWebhookHeadersSchema>
) {
  try {
    return privy.webhooks().verify({ payload, headers });
  } catch {
    return null;
  }
}
