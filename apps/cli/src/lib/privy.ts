import { PRIVY_APP_ID, PRIVY_AUTH_ORIGIN } from "@hrld/core";
import { z } from "zod";

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
    throw new Error(
      "Device authorization is not enabled for this Privy app. Enable CLI and agent access in the Privy dashboard.",
    );
  if (!res.ok) throw new Error(`Device authorization failed: HTTP ${res.status}`);

  return deviceAuthorizationSchema.parse(await res.json());
}

export async function pollForTokens(deviceCode: string, intervalSeconds: number): Promise<Tokens> {
  let delay = intervalSeconds * 1000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    });

    if (res.ok) return tokensSchema.parse(await res.json());

    const error = await res
      .json()
      .then((body) => z.object({ error: z.string() }).parse(body).error)
      .catch(() => undefined);

    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      delay += 5000;
      continue;
    }
    if (error === "expired_token")
      throw new Error("The device code expired. Run `hrld auth login` again.");
    if (error === "access_denied") throw new Error("Authorization was denied in the browser.");

    throw new Error(`Token polling failed: HTTP ${res.status}`);
  }
}

export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${PRIVY_AUTH_ORIGIN}/api/oauth/v2/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok) throw new Error("Session expired or revoked. Run `hrld auth login` again.");

  return tokensSchema.parse(await res.json());
}
