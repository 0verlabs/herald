import pc from "picocolors";
import { zodCommand } from "zod-commander";
import { getValidAccessToken } from "../lib/credentials.ts";
import { decodeAccessTokenClaims } from "../lib/jwt.ts";
import { CliError } from "../utils/errors.ts";
import { err, fields, isJson, ok } from "../utils/result.ts";

export const whoami = zodCommand({
  name: "whoami",
  description: "Show the authenticated account",
  action: async () => {
    const json = isJson(whoami);

    const accessToken = await getValidAccessToken();
    if (!accessToken)
      return err(new CliError("NOT_LOGGED_IN", "Not logged in.", "Run `hrld auth login`."))(json);

    const claims = decodeAccessTokenClaims(accessToken);
    ok(fields([["User ID", pc.cyan(claims.sub)]]), { user_id: claims.sub })(json);
  },
});
