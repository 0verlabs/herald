import { PrivyClient } from "@privy-io/node";
import { createMiddleware } from "hono/factory";

export interface PrivyClientVariables {
  privyClient: PrivyClient;
}

export interface PrivyOptions {
  appId: string;
  appSecret: string;
  webhookSigningSecret: string;
}

export const privy = ({ appId, appSecret, webhookSigningSecret }: PrivyOptions) =>
  createMiddleware<{ Variables: PrivyClientVariables }>((c, next) => {
    const privyClient = new PrivyClient({
      appId,
      appSecret,
      webhookSigningSecret,
    });

    c.set("privyClient", privyClient);

    return next();
  });
