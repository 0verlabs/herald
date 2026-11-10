import type { HeraldEnv } from "@herald/core";
import type { NearConnector } from "@hot-labs/near-connect";

let connector: Promise<NearConnector> | undefined;

/**
 * Herald's NEAR wallet connector (`@hot-labs/near-connect`), created in the
 * browser on first use: it needs `window` and IndexedDB, so it never loads
 * during SSR. It offers only wallets that can sign messages on the Herald
 * environment's NEAR network.
 */
export function nearConnector(network: HeraldEnv): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
    const created = new NearConnector({
      network,
      features:
        network === "mainnet"
          ? { signMessage: true, mainnet: true }
          : { signMessage: true, testnet: true },
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
