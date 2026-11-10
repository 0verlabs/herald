import { mpcSigners, receivingAddressPaths } from "./receiving-addresses.ts";
import { postRpc } from "./rpc.ts";
import type { HeraldEnv } from "./schemas.ts";

/**
 * Reads a signing domain's root public key from an MPC contract, as its
 * `public_key({ domain_id })` view returns it (`"secp256k1:…"`).
 */
export type MpcRootKeyReader = (request: {
  contractId: string;
  domainId: number;
}) => Promise<string>;

export type MpcRootKeyMismatch = {
  contractId: string;
  domainId: number;
  pinned: string;
  live: string;
};

export type MpcRootKeyCheck = { ok: boolean; mismatches: MpcRootKeyMismatch[] };

/**
 * Compares the pinned MPC root keys with the live contract for a Herald
 * environment (`v1.signer` or `v1.signer-prod.testnet`). If they differ, the
 * Receiving Addresses Herald derives are not the ones the contract would sign
 * for, so nothing should be paid into them. Reader errors propagate: a key
 * that couldn't be read is not a match.
 */
export async function checkMpcRootKeys(
  env: HeraldEnv,
  readRootKey: MpcRootKeyReader,
): Promise<MpcRootKeyCheck> {
  const { contractId, rootKeys } = mpcSigners[env];
  const domains = Object.values(receivingAddressPaths).map(({ domainId, curve }) => ({
    domainId,
    pinned: rootKeys[curve],
  }));
  const results = await Promise.all(
    domains.map(async ({ domainId, pinned }) => ({
      contractId,
      domainId,
      pinned,
      live: await readRootKey({ contractId, domainId }),
    })),
  );
  const mismatches = results.filter((result) => result.live !== result.pinned);
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * An `MpcRootKeyReader` that calls the contract's `public_key` view over
 * NEAR JSON-RPC, at final finality. Its errors never name `rpcUrl`, which
 * may carry an API key.
 */
export function nearRpcMpcRootKeyReader(
  rpcUrl: string,
  fetchFn: typeof fetch = fetch,
): MpcRootKeyReader {
  return async ({ contractId, domainId }) => {
    const response = await postRpc(
      fetchFn,
      rpcUrl,
      {
        jsonrpc: "2.0",
        id: "herald",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: "public_key",
          args_base64: btoa(JSON.stringify({ domain_id: domainId })),
        },
      },
      `NEAR RPC ${contractId}.public_key(${domainId})`,
    );
    const body = (await response.json()) as {
      result?: { result?: number[]; error?: string };
      error?: unknown;
    };
    const bytes = body.result?.result;
    if (!bytes) {
      const reason = body.result?.error ?? JSON.stringify(body.error);
      throw new Error(`${contractId}.public_key(${domainId}) failed: ${reason}`);
    }
    const key: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    if (typeof key !== "string") {
      throw new Error(`${contractId}.public_key(${domainId}) returned ${JSON.stringify(key)}`);
    }
    return key;
  };
}
