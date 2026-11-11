import type { HeraldEnv } from "@herald/core";
import type { NearConnector } from "@hot-labs/near-connect";

let connector: Promise<NearConnector> | undefined;

/**
 * Herald's NEAR wallet connector (`@hot-labs/near-connect`), created in the
 * browser on first use: it needs `window` and IndexedDB, so it never loads
 * during SSR. It offers only wallets on the Herald environment's NEAR
 * network that can sign messages (sign-in) and send transactions (Sweeps).
 */
export function nearConnector(network: HeraldEnv): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
    const features = { signMessage: true, signAndSendTransaction: true };
    const created = new NearConnector({
      network,
      features:
        network === "mainnet" ? { ...features, mainnet: true } : { ...features, testnet: true },
    });
    await created.whenManifestLoaded;
    return created;
  });
  return connector;
}

/** Decodes a base64 string, such as a sign-in nonce, to bytes. */
export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/**
 * The connected NEAR wallet, connecting one if none is. Throws unless it
 * holds `accountId`: a Sweep signature derives from the signing account, so
 * it must be the Provider Account signed in to the dashboard.
 */
export async function walletFor(heraldEnv: HeraldEnv, accountId: string) {
  const near = await nearConnector(heraldEnv);
  const wallet = await near.wallet().catch(() => near.connect());
  const accounts = await wallet.getAccounts({ network: heraldEnv });
  if (!accounts.some((account) => account.accountId === accountId)) {
    const connected = accounts.map((account) => account.accountId).join(", ") || "no account";
    throw new Error(
      `Your wallet is connected to ${connected}. Connect ${accountId}, the Provider Account you signed in with.`,
    );
  }
  return wallet;
}
