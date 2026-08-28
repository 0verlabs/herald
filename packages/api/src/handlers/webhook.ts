import { zValidator } from "@hono/zod-validator";
import * as schema from "@hrld/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";

import { env } from "../env";
import { registryEventSchema } from "../lib/erc-8004";
import { privyWebhookHeadersSchema, verifyWebhook } from "../lib/privy";
import { privy } from "../middlewares/privy";
import { badRequest, ok } from "../utils/response";
import type { GlobalVariables } from "../vars";
import { chainSchema } from "@hrld/core";

const webhook = new Hono<{ Variables: GlobalVariables }>();

webhook.post(
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

    const verifiedPayload = verifyWebhook({ privy, headers, payload });
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

        const [existingWallet] = await db
          .select({ userId: schema.wallets.user_id })
          .from(schema.wallets)
          .where(and(eq(schema.wallets.user_id, userId), eq(schema.wallets.network, network)));
        if (existingWallet) return ok(c);

        await db.insert(schema.wallets).values({
          user_id: userId,
          network,
          address: wallet.address,
        });

        break;
      }
      default:
        break;
    }

    return ok(c);
  }
);

webhook.post(
  "/goldsky/:chain",
  zValidator(
    "param",
    z.object({
      chain: chainSchema,
    })
  ),
  zValidator(
    "json",
    z.object({
      payload: z
        .string()
        .transform((str, ctx) => {
          try {
            return JSON.parse(str);
          } catch {
            ctx.addIssue({
              code: "invalid_value",
              values: [str],
              message: "Invalid JSON string value",
            });

            return z.NEVER;
          }
        })
        .pipe(registryEventSchema),
    })
  ),
  bearerAuth({ token: env.GOLDSKY_WEBHOOK_SECRET }),
  async (c) => {
    const { chain } = c.req.valid("param");
    const { payload } = c.req.valid("json");

    const db = c.var.db;

    switch (payload.eventName) {
      case "IdentityRegistry:Registered": {
        console.log(payload);
        return ok(c);
      }
      case "IdentityRegistry:MetadataSet": {
        return ok(c);
      }
      case "IdentityRegistry:URIUpdated": {
        return ok(c);
      }
      case "IdentityRegistry:Transfer": {
        return ok(c);
      }
    }

    return ok(c);
  }
);

export { webhook };
