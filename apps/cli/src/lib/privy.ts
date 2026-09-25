import { PRIVY_APP_ID, PRIVY_AUTH_ORIGIN } from "@hrld/core";
import { z } from "zod";
import { CliError } from "../utils/errors.ts";

const deviceAuthorizationSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});

const tokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
});

export type Tokens = z.infer<typeof tokensSchema>;

const headers = {
  "Content-Type": "application/json",
  "privy-app-id": PRIVY_APP_ID,
};

export async function requestDeviceAuthorization() {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/device_authorization`, {
    method: "POST",
    headers,
    body: "{}",
  });

  if (res.status === 403)
    throw new CliError(
      "DEVICE_AUTH_DISABLED",
      "Device authorization is not enabled for this Privy app.",
      "Enable CLI and agent access in the Privy dashboard.",
    );
  if (!res.ok)
    throw new CliError(
      "DEVICE_AUTH_FAILED",
      `Device authorization failed: HTTP ${res.status}`,
      "Check your network, then run `hrld auth login` again.",
    );

  return deviceAuthorizationSchema.parse(await res.json());
}

export async function pollForTokens(deviceCode: string, intervalSeconds: number): Promise<Tokens> {
  let delay = intervalSeconds * 1000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    const result = await exchangeDeviceCode(deviceCode);
    if (result.tokens) return result.tokens;

    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") {
      delay += 5000;
      continue;
    }

    throw toTokenError(result);
  }
}

// One-shot exchange for `auth login --complete`; unlike pollForTokens, a
// pending authorization is an error the user can retry after approving.
export async function completeDeviceAuthorization(deviceCode: string): Promise<Tokens> {
  const result = await exchangeDeviceCode(deviceCode);
  if (result.tokens) return result.tokens;

  if (result.error === "authorization_pending" || result.error === "slow_down")
    throw new CliError(
      "AUTH_PENDING",
      "Authorization is still pending.",
      "Approve the login in your browser, then run this command again.",
    );

  throw toTokenError(result);
}

type ExchangeResult =
  | { tokens: Tokens; error?: never; status?: never }
  | { tokens?: never; error: string | undefined; status: number };

async function exchangeDeviceCode(deviceCode: string): Promise<ExchangeResult> {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    }),
  });

  if (res.ok) return { tokens: tokensSchema.parse(await res.json()) };

  const error = await res
    .json()
    .then((body) => z.object({ error: z.string() }).parse(body).error)
    .catch(() => undefined);

  return { error, status: res.status };
}

function toTokenError(result: { error?: string; status: number }): Error {
  if (result.error === "expired_token")
    return new CliError(
      "DEVICE_CODE_EXPIRED",
      "The device code expired.",
      "Run `hrld auth login` to get a new code.",
    );
  if (result.error === "access_denied")
    return new CliError(
      "AUTH_DENIED",
      "Authorization was denied in the browser.",
      "Run `hrld auth login` again and approve it in the browser.",
    );

  return new CliError(
    "TOKEN_REQUEST_FAILED",
    `Token request failed: HTTP ${result.status}`,
    "Run the command again, or start over with `hrld auth login`.",
  );
}

export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok)
    throw new CliError(
      "SESSION_EXPIRED",
      "Session expired or revoked.",
      "Run `hrld auth login` to log in again.",
    );

  return tokensSchema.parse(await res.json());
}
