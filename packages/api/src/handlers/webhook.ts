import { zValidator } from "@hono/zod-validator";
import { agentIdCodec, chainSchema } from "@hrld/core";
import * as schema from "@hrld/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bytesToHex, hexToBytes, hexToString, isAddressEqual, slice, zeroAddress } from "viem";
import { z } from "zod";

import type { GlobalVariables } from "../vars";
import { env } from "../env";
import { registryEventSchema, resolveAgentRegistrationFileFromUri } from "../lib/erc-8004";
import { privyWebhookHeadersSchema, verifyWebhook } from "../lib/privy";
import { privy } from "../middlewares/privy";
import { badRequest, ok } from "../utils/response";

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
        const { agentId, agentUri, owner } = payload.args;

        const agentRegistrationFile = await resolveAgentRegistrationFileFromUri(agentUri);
        if (!agentRegistrationFile) return ok(c);

        const id = agentIdCodec.encode({ chain, onchainId: agentId });

        const ownerAddress = owner.toLowerCase();

        await db
          .insert(schema.agents)
          .values({
            id,
            chain,
            onchain_id: agentId,
            name: agentRegistrationFile.name,
            description: agentRegistrationFile.description,
            image: agentRegistrationFile.image,
            active: agentRegistrationFile.active,
            wallet: ownerAddress,
            owner: ownerAddress,
          })
          .onConflictDoNothing();

        return ok(c);
      }
      case "IdentityRegistry:MetadataSet": {
        const { agentId, metadataKey, metadataValue } = payload.args;

        const [existingAgent] = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.chain, chain), eq(schema.agents.onchain_id, agentId)));
        if (!existingAgent) return ok(c);

        switch (metadataKey) {
          case "agentWallet": {
            const bytes = hexToBytes(metadataValue as `0x${string}`);
            const addressBytes = slice(bytes, bytes.length - 20);
            const address = bytesToHex(addressBytes, { size: 20 });

            const isEmptyAddress = isAddressEqual(address, zeroAddress);

            await db
              .update(schema.agents)
              .set({ wallet: isEmptyAddress ? null : address })
              .where(eq(schema.agents.id, existingAgent.id));
            break;
          }
          case "category": {
            await db
              .update(schema.agents)
              .set({ category: hexToString(metadataValue as `0x${string}`) })
              .where(eq(schema.agents.id, existingAgent.id));
            break;
          }
        }

        return ok(c);
      }
      case "IdentityRegistry:URIUpdated": {
        const { agentId, newUri } = payload.args;

        const agentRegistrationFile = await resolveAgentRegistrationFileFromUri(newUri);
        if (!agentRegistrationFile) return ok(c);

        const [existingAgent] = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.chain, chain), eq(schema.agents.onchain_id, agentId)));
        if (!existingAgent) return ok(c);

        await db
          .update(schema.agents)
          .set({
            name: agentRegistrationFile.name,
            description: agentRegistrationFile.description,
            image: agentRegistrationFile.image,
            active: agentRegistrationFile.active,
          })
          .where(eq(schema.agents.id, existingAgent.id));

        return ok(c);
      }
      case "IdentityRegistry:Transfer": {
        const { from, to, tokenId } = payload.args;

        const isMint = isAddressEqual(from as `0x${string}`, zeroAddress);
        if (isMint) return ok(c);

        const [existingAgent] = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.chain, chain), eq(schema.agents.onchain_id, tokenId)));
        if (!existingAgent) return ok(c);

        await db
          .update(schema.agents)
          .set({ wallet: null, owner: to.toLowerCase() })
          .where(eq(schema.agents.id, existingAgent.id));

        return ok(c);
      }
    }

    return ok(c);
  }
);

export { webhook };
