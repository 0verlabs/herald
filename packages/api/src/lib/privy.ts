import type { LinkedAccount, PrivyClient } from "@privy-io/node";
import type {
  LinkedAccountCustomJwt,
  LinkedAccountEthereumEmbeddedWallet,
} from "@privy-io/node/resources";
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

export const isCustomAuthLinkedAccount = (
  linkedAccount: LinkedAccount
): linkedAccount is LinkedAccountCustomJwt =>
  linkedAccount.type === "custom_auth" && !!linkedAccount.custom_user_id;

export const isEthereumEmbeddedLinkedAccount = (
  linkedAccount: LinkedAccount
): linkedAccount is LinkedAccountEthereumEmbeddedWallet =>
  linkedAccount.type === "wallet" &&
  linkedAccount.connector_type === "embedded" &&
  linkedAccount.chain_type === "ethereum" &&
  linkedAccount.wallet_client === "privy" &&
  linkedAccount.wallet_client_type === "privy";
