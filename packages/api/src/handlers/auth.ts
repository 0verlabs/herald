import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { userWallets } from "@ivanius.ai/db";

import { createDb } from "../lib/db";
import { ok, unauthorized, unexpectedError } from "../utils/response";

const auth = new Hono<{ Bindings: Env }>().post("/webhook", async (c) => {
  try {
    const event = await verifyWebhook(c.req.raw, {
      signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET,
    }).catch(() => null);
    if (!event) return unauthorized(c);

    if (event.type !== "user.created") {
      return ok(c);
    }

    const db = createDb(c.env.DB);
    const walletClient = initiateDeveloperControlledWalletsClient({
      apiKey: c.env.CIRCLE_API_KEY,
      entitySecret: c.env.CIRCLE_ENTITY_SECRET,
    });

    const userId = event.data.id;

    const [existingUserWallet] = await db
      .select({
        circleWalletId: userWallets.circleWalletId,
      })
      .from(userWallets)
      .where(eq(userWallets.userId, userId));
    if (existingUserWallet) {
      const existingCircleWallet = await walletClient.getWallet({
        id: existingUserWallet.circleWalletId,
      });
      if (existingCircleWallet) return ok(c);
    }

    const createWalletResponse = await walletClient.createWallets({
      accountType: "EOA",
      blockchains: ["EVM-TESTNET"],
      walletSetId: c.env.CIRCLE_WALLET_SET_ID,
      count: 1,
      metadata: [{ name: "Agent Wallet", refId: userId }],
    });

    if (!createWalletResponse.data) {
      console.error("[Circle] Failed to create user wallet:", createWalletResponse.status);

      return unexpectedError(c);
    }

    const [wallet] = createWalletResponse.data.wallets;
    if (!wallet) {
      console.error("[Circle] Wallet didn't returned");

      return unexpectedError(c);
    }

    await db
      .insert(userWallets)
      .values({ userId: event.data.id, network: "evm", circleWalletId: wallet.id })
      .onConflictDoNothing();

    return ok(c);
  } catch (err) {
    console.error(err);

    return unexpectedError(c);
  }
});

export default auth;
