import type { User } from "@privy-io/react-auth";
import { shortAddress } from "../utils/address";

export function accountLabel(user: User): string {
  // user.wallet may be the Privy embedded wallet, which users don't recognize.
  // Prefer a connected external wallet, then email/phone, then embedded as last resort.
  const external = user.linkedAccounts
    .filter((account) => account.type === "wallet")
    .find((wallet) => wallet.connectorType !== "embedded" && wallet.walletClientType !== "privy");
  if (external) return shortAddress(external.address);
  const contact = user.email?.address ?? user.phone?.number;
  if (contact) return contact;
  const embedded = user.wallet?.address;
  if (embedded) return shortAddress(embedded);
  return "unknown account";
}
