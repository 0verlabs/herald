import { issueApiKey, listApiKeys, revokeApiKey } from "@herald/core/server";
import { createDb } from "@herald/db";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireSession } from "./auth";
import { readHeraldEnv } from "./herald-env";

/** The signed-in Provider's API keys, newest first, revoked ones included. */
export const getApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    return listApiKeys(createDb(env.DB), { providerId: context.session.providerId });
  });

/**
 * Issues an API key for this dashboard's Herald environment: `hk_test_…` on
 * testnet, `hk_live_…` on mainnet. The response is the only time the full
 * key leaves Herald.
 */
export const issueProviderApiKey = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .handler(async ({ context }) => {
    const { apiKey, secret } = await issueApiKey(createDb(env.DB), {
      providerId: context.session.providerId,
      env: readHeraldEnv(),
    });
    console.log(
      JSON.stringify({
        event: "api_key_created",
        account: context.session.accountId,
        apiKeyId: apiKey.id,
        prefix: apiKey.prefix,
      }),
    );
    return { apiKey, secret };
  });

/** Revokes one of the signed-in Provider's API keys. The facilitator rejects it from then on. */
export const revokeProviderApiKey = createServerFn({ method: "POST" })
  .middleware([requireSession])
  .validator(z.object({ apiKeyId: z.number().int().positive() }))
  .handler(async ({ context, data }) => {
    const revoked = await revokeApiKey(createDb(env.DB), {
      providerId: context.session.providerId,
      apiKeyId: data.apiKeyId,
    });
    if (!revoked) {
      return { ok: false as const, message: "That key doesn't exist or is already revoked." };
    }
    console.log(
      JSON.stringify({
        event: "api_key_revoked",
        account: context.session.accountId,
        apiKeyId: data.apiKeyId,
      }),
    );
    return { ok: true as const };
  });
