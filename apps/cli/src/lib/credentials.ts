import { deletePassword, getPassword, setPassword } from "cross-keychain";
import { z } from "zod";
import { refreshTokens, type Tokens } from "./privy.ts";

// cross-keychain picks the best backend automatically: native OS keychain
// first, encrypted file as a fallback.
const SERVICE = "hrld-cli";
const ACCOUNT = "default";

const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export function toCredentials(tokens: Tokens): Credentials {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await setPassword(SERVICE, ACCOUNT, JSON.stringify(credentials));
}

export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await getPassword(SERVICE, ACCOUNT).catch(() => null);
  if (!raw) return null;

  return Promise.resolve(raw)
    .then((value) => credentialsSchema.parse(JSON.parse(value)))
    .catch(() => null);
}

export async function clearCredentials(): Promise<void> {
  await deletePassword(SERVICE, ACCOUNT).catch(() => {});
}

// Refresh tokens rotate on every use, so the refreshed pair must be saved
// before the access token is handed out.
export async function getValidAccessToken(): Promise<string | null> {
  const credentials = await loadCredentials();
  if (!credentials) return null;
  if (Date.now() < credentials.expiresAt - 60_000) return credentials.accessToken;

  const tokens = await refreshTokens(credentials.refreshToken).catch(() => null);
  if (!tokens) return null;

  const next = toCredentials(tokens);
  await saveCredentials(next);
  return next.accessToken;
}
