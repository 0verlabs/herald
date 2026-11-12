import type { Caip2 } from "@herald/core";
import {
  callViewFunction,
  finalBlock,
  isStorageRegistered,
  viewAccessKey,
  viewAccount,
} from "@herald/core/server";
import type { FacilitatorNearSigner } from "@x402/near";
import { nearRelayerKey, nearRpc } from "./chains.ts";

// A verification makes several reads; each must fail fast.
const VIEW_TIMEOUT_MS = 8_000;

/**
 * The signer the stock `@x402/near` exact mechanism settles with. Reads go
 * straight to the network's NEAR RPC endpoint (`NEAR_RPC_URL`), at final
 * finality as the mechanism asks. Submitting a settlement goes through the
 * network's `NearChainQueue`, which holds the relayer key and its nonce.
 * Errors never name the endpoint: the mechanism hands them to the
 * Provider's server as `errorMessage`. The mechanism turns any submission
 * error into `settlement_failed`, so a settlement the queue answers
 * `pending` is reported to `onPending` before the error is thrown.
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
  onPending?: (signedDelegateAction: string, transaction: string) => void,
): FacilitatorNearSigner {
  // Synchronous, as the mechanism's `getSigners` needs: the relayer is the
  // implicit account of its key.
  const relayers = relayerIds(env, network);
  const rpc = nearRpc(env, network, VIEW_TIMEOUT_MS);

  return {
    getRelayerIds: () => relayers,

    getCurrentBlockHeight: async () => BigInt((await finalBlock(rpc)).height),

    viewAccount: async ({ accountId }) => {
      const account = await viewAccount(rpc, accountId);
      if (account === null) return null;
      if (typeof account.code_hash !== "string") {
        throw new Error("view_account answered no code hash");
      }
      return { codeHash: account.code_hash };
    },

    viewAccessKey: async ({ accountId, publicKey }) => {
      const key = await viewAccessKey(rpc, accountId, publicKey);
      if (key === null) return null;
      const permissionKind =
        key.permission === "FullAccess"
          ? "FullAccess"
          : typeof key.permission === "object" &&
              key.permission !== null &&
              "FunctionCall" in key.permission
            ? "FunctionCall"
            : "Unknown";
      return { nonce: key.nonce, permissionKind };
    },

    ftBalanceOf: async ({ token, accountId }) => {
      const balance = await callViewFunction(rpc, token, "ft_balance_of", {
        account_id: accountId,
      });
      if (typeof balance !== "string" || !/^\d+$/.test(balance)) {
        throw new Error(`ft_balance_of answered ${JSON.stringify(balance)}`);
      }
      return BigInt(balance);
    },

    storageBalanceOf: async ({ token, accountId }) => ({
      supported: true,
      registered: await isStorageRegistered(rpc, token, accountId),
    }),

    submitSignedDelegateAction: async ({ signedDelegateAction }) => {
      const queue = env.NEAR_CHAIN_QUEUE.getByName(network);
      const settled = await queue.submitSettlement({ network, signedDelegateAction });
      if (!settled.ok) {
        if (settled.pending) onPending?.(signedDelegateAction, settled.transaction);
        throw new Error(settled.message);
      }
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
