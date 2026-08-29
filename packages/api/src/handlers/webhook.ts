import type { AgentId } from "@hrld/core";
import { zValidator } from "@hono/zod-validator";
import { agentIdCodec, chainSchema } from "@hrld/core";
import * as schema from "@hrld/db";
import { and, avg, between, count, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bytesToHex, hexToBytes, hexToString, isAddressEqual, slice, zeroAddress } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";
import type { Erc8004AgentService } from "../lib/erc-8004";
import type { GlobalVariables } from "../vars";
import { env } from "../env";
import {
  erc8004RegistryEventSchema,
  isErc8004AgentApiService,
  isErc8004AgentJobService,
  isErc8004AgentMcpService,
  normalizeErc8004FeedbackValue,
  resolveErc8004AgentRegistrationFile,
  resolveErc8004FeedbackFile,
} from "../lib/erc-8004";
import { privyWebhookHeadersSchema, verifyWebhook } from "../lib/privy";
import { privy } from "../middlewares/privy";
import { badRequest, ok } from "../utils/response";

export const webhook = new Hono<{ Variables: GlobalVariables }>()
  .post(
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
  )
  .post(
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
          .pipe(erc8004RegistryEventSchema),
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

          const agentRegistrationFile = await resolveErc8004AgentRegistrationFile(agentUri);
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

          await syncAgentServices(db, id, agentRegistrationFile.services);

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

          const agentRegistrationFile = await resolveErc8004AgentRegistrationFile(newUri);
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

          await syncAgentServices(db, existingAgent.id, agentRegistrationFile.services);

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
        case "ReputationRegistry:NewFeedback": {
          const { agentId, clientAddress, feedbackIndex, value, valueDecimals, feedbackURI } =
            payload.args;

          const [existingAgent] = await db
            .select({ id: schema.agents.id })
            .from(schema.agents)
            .where(and(eq(schema.agents.chain, chain), eq(schema.agents.onchain_id, agentId)));
          if (!existingAgent) return ok(c);

          // The onchain fields are authoritative; the file only adds context. A
          // missing or broken file must not block the score from being stored.
          const feedbackFile = feedbackURI ? await resolveErc8004FeedbackFile(feedbackURI) : null;

          await db
            .insert(schema.agentFeedback)
            .values({
              agent_id: existingAgent.id,
              client_address: clientAddress.toLowerCase(),
              feedback_index: feedbackIndex,
              value: normalizeErc8004FeedbackValue(value, valueDecimals),
              reasoning: feedbackFile?.reasoning ?? null,
              proof_of_payment: feedbackFile?.proofOfPayment ?? null,
            })
            .onConflictDoNothing();

          await syncAgentScore(db, existingAgent.id);

          return ok(c);
        }
        case "ReputationRegistry:FeedbackRevoked": {
          const { agentId, clientAddress, feedbackIndex } = payload.args;

          const [existingAgent] = await db
            .select({ id: schema.agents.id })
            .from(schema.agents)
            .where(and(eq(schema.agents.chain, chain), eq(schema.agents.onchain_id, agentId)));
          if (!existingAgent) return ok(c);

          await db
            .update(schema.agentFeedback)
            .set({ revoked_at: new Date() })
            .where(
              and(
                eq(schema.agentFeedback.agent_id, existingAgent.id),
                eq(schema.agentFeedback.client_address, clientAddress.toLowerCase()),
                eq(schema.agentFeedback.feedback_index, feedbackIndex)
              )
            );

          await syncAgentScore(db, existingAgent.id);

          return ok(c);
        }
      }

      return ok(c);
    }
  );

const syncAgentScore = async (db: Db, agentId: AgentId) => {
  const [summary] = await db
    .select({ average: avg(schema.agentFeedback.value), total: count() })
    .from(schema.agentFeedback)
    .where(
      and(
        eq(schema.agentFeedback.agent_id, agentId),
        isNull(schema.agentFeedback.revoked_at),
        between(schema.agentFeedback.value, 0, 100)
      )
    );

  await db
    .update(schema.agents)
    .set({ score: Math.round(Number(summary?.average ?? 0)), feedback_counts: summary?.total ?? 0 })
    .where(eq(schema.agents.id, agentId));
};

const syncAgentServices = async (
  db: Db,
  agentId: AgentId,
  services: Erc8004AgentService[] = []
) => {
  await Promise.all([
    db.delete(schema.agentJobServices).where(eq(schema.agentJobServices.agent_id, agentId)),
    db.delete(schema.agentApiServices).where(eq(schema.agentApiServices.agent_id, agentId)),
    db.delete(schema.agentMcpServices).where(eq(schema.agentMcpServices.agent_id, agentId)),
  ]);

  const erc8004JobServices = services.filter(isErc8004AgentJobService);
  const erc8004ApiServices = services.filter(isErc8004AgentApiService);
  const erc8004McpServices = services.filter(isErc8004AgentMcpService);

  await Promise.all([
    erc8004JobServices.length
      ? db.insert(schema.agentJobServices).values(
          erc8004JobServices.map((service) => ({
            agent_id: agentId,
            title: service.title,
            description: service.description,
          }))
        )
      : undefined,
    erc8004ApiServices.length
      ? db.insert(schema.agentApiServices).values(
          erc8004ApiServices.map((service) => ({
            agent_id: agentId,
            name: service.name,
            method: service.method,
            endpoint: service.endpoint,
            version: service.version,
            description: service.description,
          }))
        )
      : undefined,
    erc8004McpServices.length
      ? db.insert(schema.agentMcpServices).values(
          erc8004McpServices.map((service) => ({
            agent_id: agentId,
            endpoint: service.endpoint,
            version: service.version,
            tools: service.mcpTools ?? [],
            resources: service.mcpResources ?? [],
            prompts: service.mcpPrompts ?? [],
          }))
        )
      : undefined,
  ]);
};
