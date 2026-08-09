import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { userWallets } from "@ivanius.ai/db";

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

    const payload = await c.req.json();
    const headers = c.req.valid("header");

    const verifiedPayload = privy.webhooks().verify({
      payload,
      headers,
    });

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
          .select({ userId: userWallets.userId })
          .from(userWallets)
          .where(and(eq(userWallets.userId, userId), eq(userWallets.network, network)));
        if (existingUserWallet) return ok(c);

        await db.insert(userWallets).values({
          userId,
          network,
          walletAddress: wallet.address,
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
