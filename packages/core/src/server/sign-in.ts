import { signInNonces } from "@herald/db/schema";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import { and, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import { postRpc } from "../rpc.ts";
import { NearAccountIdSchema, type HeraldEnv, type Provider } from "../schemas.ts";
import type { Db } from "./db.ts";
import {
  ensureSolanaTokenAccountQueued,
  registerProvider,
  type SolanaTokenAccountQueue,
} from "./providers.ts";

/** How long a sign-in challenge can be signed and sent back. */
export const SIGN_IN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * What the dashboard asks the Provider's NEAR wallet to sign with
 * `signMessage` (NEP-413). `nonce` is 32 random bytes, base64-encoded; the
 * wallet takes them as bytes. `recipient` names the dashboard the signature
 * is for.
 */
export type SignInChallenge = {
  message: string;
  recipient: string;
  nonce: string;
  expiresAt: Date;
};

/**
 * What a NEAR wallet's `signMessage` returns for a challenge, with the
 * challenge's nonce: the account, the public key it signed with, and the
 * ed25519 signature (base64, as NEP-413 specifies).
 */
export const SignInSignatureSchema = z.object({
  accountId: NearAccountIdSchema,
  publicKey: z
    .string()
    .regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Herald signs in with ed25519 keys only"),
  signature: z.string().min(1).max(200),
  nonce: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "Not a Herald sign-in nonce"),
});
export type SignInSignature = z.infer<typeof SignInSignatureSchema>;

/**
 * Reads a public key's permission on a NEAR account: `full_access`,
 * `limited` (a function-call key, or any other kind), or null if the
 * account has no such key.
 */
export type NearAccessKeyReader = (request: {
  accountId: string;
  publicKey: string;
}) => Promise<"full_access" | "limited" | null>;

export type SignInRejection =
  | "invalid_request"
  | "unknown_nonce"
  | "bad_signature"
  | "unknown_key"
  | "not_full_access"
  | "near_rpc_failed";

export type SignInResult =
  | { ok: true; provider: Provider }
  | { ok: false; reason: SignInRejection; message: string };

/** The text the wallet shows the Provider when it signs in. */
export function signInMessage(env: HeraldEnv): string {
  return `Sign in to the Herald dashboard (${env}). This proves you control this NEAR account. It sends no transaction and costs nothing.`;
}

/**
 * Issues a sign-in challenge for a dashboard `recipient` (its host). Its
 * nonce can be used once, within `SIGN_IN_CHALLENGE_TTL_MS`. Also clears out
 * expired nonces.
 */
export async function createSignInChallenge(
  db: Db,
  input: { env: HeraldEnv; recipient: string },
): Promise<SignInChallenge> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGN_IN_CHALLENGE_TTL_MS);
  const nonce = base64.encode(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.delete(signInNonces).where(lte(signInNonces.expiresAt, now)),
    db.insert(signInNonces).values({ nonce, expiresAt }),
  ]);
  return { message: signInMessage(input.env), recipient: input.recipient, nonce, expiresAt };
}

/**
 * Signs a Provider in from its wallet's signature over a sign-in challenge,
 * and registers the Provider Account the first time, handing its Solana
 * USDC token account to the Solana chain queue until one call succeeds (see
 * `ensureSolanaTokenAccountQueued`). The signature must
 * cover Herald's message for `env`, `recipient` and a nonce Herald issued
 * and nobody has used yet. The key must be a full-access key of the account,
 * which `readAccessKey` checks over NEAR RPC; if that check fails, the
 * result is a `near_rpc_failed` rejection. The nonce is used up whatever the
 * outcome, so a rejected attempt needs a new challenge.
 */
export async function signIn(
  deps: {
    db: Db;
    readAccessKey: NearAccessKeyReader;
    queueSolanaTokenAccount: SolanaTokenAccountQueue;
  },
  input: { env: HeraldEnv; recipient: string; signature: unknown },
): Promise<SignInResult> {
  const parsed = SignInSignatureSchema.safeParse(input.signature);
  if (!parsed.success) {
    return reject("invalid_request", parsed.error.issues[0]?.message ?? "Invalid sign-in request.");
  }
  const { accountId, publicKey, signature, nonce } = parsed.data;

  const used = await deps.db
    .delete(signInNonces)
    .where(and(eq(signInNonces.nonce, nonce), gt(signInNonces.expiresAt, new Date())))
    .returning({ nonce: signInNonces.nonce });
  if (used.length === 0) {
    return reject(
      "unknown_nonce",
      "This sign-in request expired or was already used. Sign in again.",
    );
  }

  const payload = { message: signInMessage(input.env), recipient: input.recipient, nonce };
  if (!verifyNep413Signature(payload, publicKey, signature)) {
    return reject("bad_signature", "The signature doesn't match this key and sign-in request.");
  }

  let permission;
  try {
    permission = await deps.readAccessKey({ accountId, publicKey });
  } catch (error) {
    // Logged, not shown: the reader's error is for Herald, not the Provider.
    console.warn(
      JSON.stringify({ event: "near_access_key_check_failed", accountId, error: String(error) }),
    );
    return reject("near_rpc_failed", "Herald couldn't check your key with NEAR. Try again.");
  }
  if (permission === null) {
    return reject("unknown_key", `${publicKey} is not an access key of ${accountId}.`);
  }
  if (permission !== "full_access") {
    return reject(
      "not_full_access",
      `${publicKey} is a limited access key of ${accountId}. Sign in with a full-access key.`,
    );
  }

  const provider = await registerProvider(deps.db, { accountId, env: input.env });
  return {
    ok: true,
    provider: await ensureSolanaTokenAccountQueued(deps, { provider, env: input.env }),
  };
}

function reject(reason: SignInRejection, message: string): SignInResult {
  return { ok: false, reason, message };
}

// NEP-413: the wallet signs SHA-256 of the borsh-serialized payload, prefixed
// with the tag 2^31 + 413. Herald never sets a callbackUrl.
const NEP413_TAG = 2 ** 31 + 413;

function verifyNep413Signature(
  payload: { message: string; recipient: string; nonce: string },
  publicKey: string,
  signature: string,
): boolean {
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes) return false;
  const hash = sha256(
    concatBytes(
      borshU32(NEP413_TAG),
      borshString(payload.message),
      base64.decode(payload.nonce),
      borshString(payload.recipient),
      Uint8Array.of(0), // callbackUrl: None
    ),
  );
  try {
    return ed25519.verify(signatureBytes, hash, decodeNearEd25519(publicKey));
  } catch {
    return false;
  }
}

// NEP-413 signatures are base64. Some wallets return NEAR's `ed25519:<base58>`
// form instead.
function decodeSignature(signature: string): Uint8Array | null {
  try {
    const bytes = signature.startsWith(ED25519_PREFIX)
      ? decodeNearEd25519(signature)
      : base64.decode(signature);
    return bytes.length === 64 ? bytes : null;
  } catch {
    return null;
  }
}

const ED25519_PREFIX = "ed25519:";

/** Decodes NEAR's `ed25519:<base58>` form of a key or signature. */
function decodeNearEd25519(value: string): Uint8Array {
  return base58.decode(value.slice(ED25519_PREFIX.length));
}

function borshU32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function borshString(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  return concatBytes(borshU32(utf8.length), utf8);
}

/**
 * A `NearAccessKeyReader` that calls `view_access_key` over NEAR JSON-RPC, at
 * final finality. Its errors never name `rpcUrl`, which may carry an API key.
 */
export function nearRpcAccessKeyReader(
  rpcUrl: string,
  fetchFn: typeof fetch = fetch,
): NearAccessKeyReader {
  return async ({ accountId, publicKey }) => {
    const response = await postRpc(
      fetchFn,
      rpcUrl,
      {
        jsonrpc: "2.0",
        id: "herald",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: accountId,
          public_key: publicKey,
        },
      },
      "NEAR RPC view_access_key",
    );
    const body = (await response.json()) as {
      result?: { permission?: unknown; error?: string };
      error?: { cause?: { name?: string } };
    };
    // Nodes report a missing key or account either as `result.error` ("…
    // does not exist while viewing") or as a top-level error with a cause.
    const cause = body.error?.cause?.name;
    if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return null;
    if (body.result?.error?.includes("does not exist")) return null;
    if (body.error || body.result?.error || body.result?.permission === undefined) {
      throw new Error(
        `view_access_key(${accountId}, ${publicKey}) failed: ${JSON.stringify(body.error ?? body.result)}`,
      );
    }
    return body.result.permission === "FullAccess" ? "full_access" : "limited";
  };
}
