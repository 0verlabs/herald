import type { PrivyClient } from "@privy-io/node";
import { z } from "zod";

export const privyWebhookHeadersSchema = z.object({
  "svix-id": z.string(),
  "svix-signature": z.string(),
  "svix-timestamp": z.string(),
});
export type PrivyWebhookHeaders = z.infer<typeof privyWebhookHeadersSchema>;

export interface PrivyWebhookParams {
  privy: PrivyClient;
  payload: string;
  headers: PrivyWebhookHeaders;
}

export const verifyWebhook = ({ privy, headers, payload }: PrivyWebhookParams) => {
  try {
    return privy.webhooks().verify({ headers, payload });
  } catch {
    return null;
  }
};
