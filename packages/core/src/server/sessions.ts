import { bytesToHex } from "@noble/curves/utils.js";
import { base64urlnopad } from "@scure/base";
import { z } from "zod";
import { NearAccountIdSchema, type Provider } from "../schemas.ts";

/** How long a dashboard session lasts. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Where sessions live: a Workers KV namespace, or anything with the same
 * `get`, `put` and `delete`. Entries expire on their own after the TTL.
 */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A signed-in Provider's dashboard session. */
export const SessionSchema = z.object({
  providerId: z.number().int().positive(),
  accountId: NearAccountIdSchema,
  expiresAt: z.coerce.date(),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Starts a session for a signed-in Provider, always under a new token. Pass
 * the browser's current token as `replacing` to end that session first, so a
 * token planted before sign-in never becomes a signed-in one. `token` goes
 * into the session cookie and is never stored: the store keys the session by
 * its SHA-256 hash, so reading the store doesn't yield usable tokens.
 */
export async function startSession(
  store: SessionStore,
  provider: Provider,
  options: { replacing?: string } = {},
): Promise<{ token: string; session: Session }> {
  await endSession(store, options.replacing);
  const token = base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(32)));
  const session: Session = {
    providerId: provider.id,
    accountId: provider.accountId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  };
  await store.put(await sessionKey(token), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return { token, session };
}

/** The session a token belongs to, or null if it has none or it expired. */
export async function readSession(
  store: SessionStore,
  token: string | undefined,
): Promise<Session | null> {
  if (!token) return null;
  const stored = await store.get(await sessionKey(token));
  if (!stored) return null;
  const session = SessionSchema.safeParse(JSON.parse(stored));
  if (!session.success || session.data.expiresAt.getTime() <= Date.now()) return null;
  return session.data;
}

/** Ends the session a token belongs to, if any. */
export async function endSession(store: SessionStore, token: string | undefined): Promise<void> {
  if (token) await store.delete(await sessionKey(token));
}

async function sessionKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `session:${bytesToHex(new Uint8Array(digest))}`;
}
