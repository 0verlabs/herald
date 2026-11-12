import type { Caip2 } from "@herald/core";
import type { FacilitatorNearSigner } from "@x402/near";
import { NearRpcError, nearRelayerKey, nearRpc } from "./chains.ts";

// A verification makes several reads; each must fail fast.
const VIEW_TIMEOUT_MS = 8_000;

type ViewResult = { result?: number[]; error?: string };

/**
 * The signer the stock `@x402/near` exact mechanism settles with. Reads go
 * straight to the network's NEAR RPC endpoint (`NEAR_RPC_URL`), at final
 * finality as the mechanism asks. Submitting a settlement goes through the
 * network's `NearChainQueue`, which holds the relayer key and its nonce.
 * Errors never name the endpoint: the mechanism hands them to the
 * Provider's server as `errorMessage`.
 *
 * Without a usable `NEAR_RELAYER_KEY` the signer has no relayer: the network
 * stays listed in `/supported` (so Providers' routes offering it still
 * initialize), and the stock mechanism refuses its payments with
 * `invalid_exact_near_no_relayer_configured` before reading the chain. Other
 * chains are unaffected.
 */
export function facilitatorNearSigner(
  env: CloudflareBindings,
  network: Caip2,
): FacilitatorNearSigner {
  // Synchronous, as the mechanism's `getSigners` needs: the relayer is the
  // implicit account of its key.
  const relayers = relayerIds(env, network);
  const query = (params: Record<string, unknown>) =>
    nearRpc(env, network, "query", { finality: "final", ...params }, VIEW_TIMEOUT_MS);
  const view = async (contract: string, method: string, args: unknown): Promise<unknown> => {
    const answer = (await query({
      request_type: "call_function",
      account_id: contract,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    })) as ViewResult;
    if (!answer.result) throw new Error(`${method} on ${contract} failed: ${answer.error}`);
    return JSON.parse(new TextDecoder().decode(new Uint8Array(answer.result)));
  };

  return {
    getRelayerIds: () => relayers,

    getCurrentBlockHeight: async () => {
      const block = (await nearRpc(
        env,
        network,
        "block",
        { finality: "final" },
        VIEW_TIMEOUT_MS,
      )) as {
        header?: { height?: unknown };
      };
      if (typeof block.header?.height !== "number")
        throw new Error("NEAR RPC block answered no height");
      return BigInt(block.header.height);
    },

    viewAccount: async ({ accountId }) => {
      try {
        const account = (await query({ request_type: "view_account", account_id: accountId })) as {
          code_hash?: unknown;
        };
        if (typeof account.code_hash !== "string")
          throw new Error("view_account answered no code hash");
        return { codeHash: account.code_hash };
      } catch (error) {
        if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_ACCOUNT") return null;
        throw error;
      }
    },

    viewAccessKey: async ({ accountId, publicKey }) => {
      let key: { nonce?: unknown; permission?: unknown; error?: unknown };
      try {
        key = (await query({
          request_type: "view_access_key",
          account_id: accountId,
          public_key: publicKey,
        })) as typeof key;
      } catch (error) {
        if (error instanceof NearRpcError && error.rpcCause === "UNKNOWN_ACCESS_KEY") return null;
        throw error;
      }
      // Most nodes answer a missing key inside `result`.
      if (typeof key.error === "string" && /does not exist/i.test(key.error)) return null;
      if (typeof key.nonce !== "number") throw new Error("view_access_key answered no nonce");
      const permissionKind =
        key.permission === "FullAccess"
          ? "FullAccess"
          : typeof key.permission === "object" &&
              key.permission !== null &&
              "FunctionCall" in key.permission
            ? "FunctionCall"
            : "Unknown";
      return { nonce: BigInt(key.nonce), permissionKind };
    },

    ftBalanceOf: async ({ token, accountId }) => {
      const balance = await view(token, "ft_balance_of", { account_id: accountId });
      if (typeof balance !== "string" || !/^\d+$/.test(balance)) {
        throw new Error(`ft_balance_of answered ${JSON.stringify(balance)}`);
      }
      return BigInt(balance);
    },

    storageBalanceOf: async ({ token, accountId }) => {
      const balance = await view(token, "storage_balance_of", { account_id: accountId });
      return { supported: true, registered: balance !== null };
    },

    submitSignedDelegateAction: async ({ signedDelegateAction }) => {
      const queue = env.NEAR_CHAIN_QUEUE.getByName(network);
      const settled = await queue.submitSettlement({ network, signedDelegateAction });
      if (!settled.ok) throw new Error(settled.message);
      return { transaction: settled.transaction, innerReceipt: settled.innerReceipt };
    },
  };
}

/**
 * The relayer's account id, or none if `NEAR_RELAYER_KEY` is missing or
 * invalid. That is logged (never the key) on each request that builds the
 * facilitator, until the secret is fixed.
 */
function relayerIds(env: CloudflareBindings, network: Caip2): string[] {
  try {
    return [nearRelayerKey(env).accountId];
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "near_relayer_unavailable",
        network,
        // nearRelayerKey's messages describe the expected format only.
        message: `${error instanceof Error ? error.message : "NEAR_RELAYER_KEY is unusable"}. Payments on ${network} are refused until it is fixed.`,
      }),
    );
    return [];
  }
}
