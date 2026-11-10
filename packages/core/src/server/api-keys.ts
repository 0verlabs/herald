import { apiKeys, providers } from "@herald/db/schema";
import { bytesToHex } from "@noble/curves/utils.js";
import { base58 } from "@scure/base";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  apiKeyPrefixes,
  ApiKeySchema,
  ProviderSchema,
  type ApiKey,
  type HeraldEnv,
  type Provider,
} from "../schemas.ts";
import type { Db } from "./db.ts";

// `hk_test_` plus four characters of the random part: enough to tell keys
// apart in the dashboard, far too little to guess the rest.
const DISPLAY_PREFIX_LENGTH = 12;

/**
 * Issues a new API key for a Provider in a Herald environment. `secret` is
 * the full key, returned only here; Herald keeps its SHA-256 hash.
 */
export async function issueApiKey(
  db: Db,
  input: { providerId: number; env: HeraldEnv },
): Promise<{ apiKey: ApiKey; secret: string }> {
  const random = base58.encode(crypto.getRandomValues(new Uint8Array(24)));
  const secret = `${apiKeyPrefixes[input.env]}${random}`;
  const [row] = await db
    .insert(apiKeys)
    .values({
      providerId: input.providerId,
      env: input.env,
      prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
      hash: await hashApiKey(secret),
    })
    .returning();
  return { apiKey: ApiKeySchema.parse(row), secret };
}

/**
 * A Provider's API keys, newest first, revoked ones included. Only their
 * display prefixes: the keys themselves are never stored.
 */
export async function listApiKeys(db: Db, input: { providerId: number }): Promise<ApiKey[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.providerId, input.providerId))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
  return rows.map((row) => ApiKeySchema.parse(row));
}

/**
 * Revokes one of a Provider's API keys. It stops working at once. Returns
 * false if the Provider has no such key or it was already revoked.
 */
export async function revokeApiKey(
  db: Db,
  input: { providerId: number; apiKeyId: number },
): Promise<boolean> {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.providerId, input.providerId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  return revoked.length > 0;
}

export type ApiKeyRejection = "missing" | "invalid" | "revoked" | "wrong_environment";

export type ApiKeyAuthentication =
  | { ok: true; apiKey: ApiKey; provider: Provider }
  | { ok: false; reason: ApiKeyRejection; message: string };

/**
 * Finds the Provider an API key belongs to, for a Herald environment. A key
 * is accepted only if it exists, isn't revoked, and was issued for `env`.
 */
export async function authenticateApiKey(
  db: Db,
  input: { secret: string | undefined; env: HeraldEnv },
): Promise<ApiKeyAuthentication> {
  const { secret, env } = input;
  if (!secret) {
    return reject("missing", "Send a Herald API key as `Authorization: Bearer hk_…`.");
  }
  const keyEnv = (Object.keys(apiKeyPrefixes) as HeraldEnv[]).find((candidate) =>
    secret.startsWith(apiKeyPrefixes[candidate]),
  );
  if (!keyEnv) return reject("invalid", "Not a Herald API key.");
  if (keyEnv !== env) return wrongEnvironment(env);

  const [row] = await db
    .select({ apiKey: apiKeys, provider: providers })
    .from(apiKeys)
    .innerJoin(providers, eq(apiKeys.providerId, providers.id))
    .where(eq(apiKeys.hash, await hashApiKey(secret)));
  if (!row) return reject("invalid", "Unknown Herald API key.");
  if (row.apiKey.env !== env) return wrongEnvironment(env);
  if (row.apiKey.revokedAt) return reject("revoked", "This Herald API key has been revoked.");
  return {
    ok: true,
    apiKey: ApiKeySchema.parse(row.apiKey),
    provider: ProviderSchema.parse(row.provider),
  };
}

function reject(reason: ApiKeyRejection, message: string): ApiKeyAuthentication {
  return { ok: false, reason, message };
}

function wrongEnvironment(env: HeraldEnv): ApiKeyAuthentication {
  return reject(
    "wrong_environment",
    `This is Herald's ${env} facilitator; it only accepts ${apiKeyPrefixes[env]} keys.`,
  );
}

async function hashApiKey(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return bytesToHex(new Uint8Array(digest));
}
