import { clerkMiddleware, getAuth } from "@clerk/hono";
import { networkSchema } from "@hrld/core";
import * as schema from "@hrld/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { env } from "../env";
import { isEthereumEmbeddedLinkedAccount } from "../lib/privy";
import { privy } from "../middlewares/privy";
import { ok, unauthorized } from "../utils/response";

const userWalletSchema = z.object({
  address: z.string(),
  network: networkSchema,
});

export const wallets = new Hono<{ Variables: GlobalVariables }>()
  .use(
    clerkMiddleware({
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
      secretKey: env.CLERK_SECRET_KEY,
    }),
    privy({
      appId: env.PRIVY_APP_ID,
      appSecret: env.PRIVY_APP_SECRET,
      webhookSigningSecret: env.PRIVY_WEBHOOK_SIGNING_SECRET,
    })
  )
  .post("/", async (c) => {
    const { userId, getToken } = getAuth(c);
    if (!userId) return unauthorized(c);

    const token = await getToken();
    if (!token) return unauthorized(c);

    const user = await c.var.privyClient.users().getByCustomAuthID({
      custom_user_id: userId,
    });
    if (!user) {
      await c.var.privyClient.users().create({
        linked_accounts: [
          {
            type: "custom_auth",
            custom_user_id: userId,
          },
        ],
        wallets: [
          {
            chain_type: "ethereum",
            additional_signers: [
              {
                signer_id: env.PRIVY_AUTHORIZATION_ID,
              },
            ],
          },
        ],
      });

      return ok(c);
    }

    const [existingWallet] = user.linked_accounts.filter((account) =>
      isEthereumEmbeddedLinkedAccount(account)
    );
    if (!existingWallet) {
      await c.var.privyClient.wallets().create({
        chain_type: "ethereum",
        owner: {
          user_id: user.id,
        },
        additional_signers: [
          {
            signer_id: env.PRIVY_AUTHORIZATION_ID,
          },
        ],
      });

      return ok(c);
    }

    const wallet = await c.var.privyClient.wallets().getWalletByAddress({
      address: existingWallet.address,
    });
    const delegated = wallet.additional_signers.find(
      ({ signer_id }) => signer_id === env.PRIVY_AUTHORIZATION_ID
    );
    if (!delegated) {
      await c.var.privyClient.wallets().update(wallet.id, {
        authorization_context: {
          user_jwts: [token],
        },
        additional_signers: [
          {
            signer_id: env.PRIVY_AUTHORIZATION_ID,
          },
        ],
      });

      return ok(c);
    }

    return ok(c);
  })
  .get("/", async (c) => {
    const { userId } = getAuth(c);
    if (!userId) return unauthorized(c);

    const rows = await c.var.db
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.user_id, userId));

    const wallets = userWalletSchema.array().parse(
      rows.map((row) => ({
        address: row.address,
        network: row.network,
      }))
    );

    return ok(c, wallets);
  });
