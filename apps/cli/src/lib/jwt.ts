import { z } from "zod";

const accessTokenClaimsSchema = z.object({
  sub: z.string(),
  sid: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

// Access tokens are JWTs whose `sub` claim is the user's Privy DID, so the
// user id is available without a network call. Signature verification is the
// server's concern, not the CLI's.
export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims {
  const [, payload = ""] = accessToken.split(".");
  return accessTokenClaimsSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
}
