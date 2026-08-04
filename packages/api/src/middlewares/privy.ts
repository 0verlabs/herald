import { PrivyClient } from "@privy-io/node";
import { createMiddleware } from "hono/factory";

export interface PrivyClientVariables {
  privyClient: PrivyClient;
}

export const privy = () =>
  createMiddleware<{ Bindings: Env; Variables: PrivyClientVariables }>((c, next) => {
    const privyClient = new PrivyClient({
      appId: c.env.PRIVY_APP_ID,
      appSecret: c.env.PRIVY_APP_SECRET,
      webhookSigningSecret: c.env.PRIVY_WEBHOOK_SIGNING_SECRET,
    });

    c.set("privyClient", privyClient);

    return next();
  });
