import {
  createSignInChallenge,
  endSession,
  isHeraldAdmin,
  nearRpcAccessKeyReader,
  readSession,
  SESSION_TTL_SECONDS,
  signIn,
  SignInSignatureSchema,
  startSession,
} from "@herald/core/server";
import { createDb } from "@herald/db";
import { redirect } from "@tanstack/react-router";
import { createMiddleware, createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { readHeraldEnv } from "./herald-env";
import { nearSetupQueue } from "./near-chain-queue";
import { solanaTokenAccountQueue } from "./solana-chain-queue";

// Every `env`, cookie and request read stays inside a server function,
// middleware `.server()` or `createServerOnlyFn`, which the client build
// strips (see herald-env.ts).

/**
 * The session cookie: HTTP-only, SameSite=Lax, and `__Host-` prefixed and
 * Secure over HTTPS. Plain HTTP only happens in local development.
 */
const sessionCookie = createServerOnlyFn(() => {
  const secure = new URL(getRequest().url).protocol === "https:";
  return {
    name: secure ? "__Host-herald_session" : "herald_session",
    options: { httpOnly: true, secure, sameSite: "lax", path: "/" } as const,
  };
});

/** The session cookie's token, if the browser sent one. Server only. */
export const sessionToken = createServerOnlyFn(() => getCookie(sessionCookie().name));

const currentSession = createServerOnlyFn(async () => {
  const token = sessionToken();
  return { token, session: await readSession(env.SESSIONS, token) };
});

/** The host the dashboard is served on. Wallet signatures must name it. */
const signInRecipient = createServerOnlyFn(() => new URL(getRequest().url).host);

const withinSignInRateLimit = createServerOnlyFn(async () => {
  const ip = getRequest().headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.SIGN_IN_RATE_LIMITER.limit({ key: ip });
  return success;
});

const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait a minute and try again.";

/**
 * Loads the signed-in Provider's session into `context.session`, or
 * redirects to sign-in. Every server function that reads or changes a
 * Provider's data uses it; route guards only shape navigation.
 */
export const requireSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { session } = await currentSession();
  if (!session) throw redirect({ to: "/sign-in" });
  return next({ context: { session } });
});

/**
 * The signed-in Provider Account, and whether it is a Herald admin, or
 * null. For route guards and navigation; admin server functions check
 * `requireAdmin` themselves.
 */
export const getSessionAccount = createServerFn({ method: "GET" }).handler(async () => {
  const { session } = await currentSession();
  if (!session) return null;
  return {
    accountId: session.accountId,
    isAdmin: isHeraldAdmin(session.accountId, { admins: env.HERALD_ADMINS }),
  };
});

/** Issues the NEP-413 challenge the Provider's wallet signs to sign in. */
export const getSignInChallenge = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await withinSignInRateLimit())) return { ok: false as const, message: TOO_MANY_ATTEMPTS };
  const challenge = await createSignInChallenge(createDb(env.DB), {
    env: readHeraldEnv(),
    recipient: signInRecipient(),
  });
  return {
    ok: true as const,
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: challenge.nonce,
  };
});

/**
 * Signs the Provider in from its wallet's signature over a challenge,
 * registering it on first sign-in, queueing its Solana USDC token account
 * and its NEAR Receiving Address setup with the facilitator's chain queues,
 * and starts a session in a fresh cookie.
 */
export const signInWithSignature = createServerFn({ method: "POST" })
  .validator(SignInSignatureSchema)
  .handler(async ({ data }) => {
    if (!(await withinSignInRateLimit())) return { ok: false as const, message: TOO_MANY_ATTEMPTS };
    const result = await signIn(
      {
        db: createDb(env.DB),
        readAccessKey: nearRpcAccessKeyReader(env.NEAR_RPC_URL),
        queueSolanaTokenAccount: solanaTokenAccountQueue(),
        queueNearSetup: nearSetupQueue(),
      },
      { env: readHeraldEnv(), recipient: signInRecipient(), signature: data },
    );
    if (!result.ok) {
      console.warn(
        JSON.stringify({
          event: "sign_in_rejected",
          reason: result.reason,
          account: data.accountId,
        }),
      );
      return { ok: false as const, message: result.message };
    }

    const { token } = await startSession(env.SESSIONS, result.provider, {
      replacing: getCookie(sessionCookie().name),
    });
    const cookie = sessionCookie();
    setCookie(cookie.name, token, { ...cookie.options, maxAge: SESSION_TTL_SECONDS });
    console.log(JSON.stringify({ event: "sign_in", account: result.provider.accountId }));
    return { ok: true as const };
  });

/** Ends the session and clears its cookie. */
export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { token } = await currentSession();
  await endSession(env.SESSIONS, token);
  const cookie = sessionCookie();
  deleteCookie(cookie.name, cookie.options);
});
