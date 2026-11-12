import { base58 } from "@scure/base";
import type { Network } from "../networks.ts";
import {
  encodeDelegateAction,
  finalBlock,
  ftTransferOutcome,
  functionCallAction,
  isStorageRegistered,
  NearRpcError,
  nearRpcAt,
  viewAccessKey,
  type NearOutcome,
} from "./near-protocol.ts";

// A NEAR Sweep is a NEP-366 delegate action from the NEAR Receiving Address
// (an implicit account) holding one USDC `ft_transfer`. The MPC signer
// signs its NEP-461 hash for the Receiving Address, and Herald's relayer
// submits it, paying the gas.

type NearNetwork = Extract<Network, { kind: "near" }>;

/** The gas a Sweep's `ft_transfer` gets: 30 Tgas, what NEP-141 wallets attach. */
export const NEAR_FT_TRANSFER_GAS = 30_000_000_000_000n;

/**
 * The Borsh encoding of a Sweep's `DelegateAction` (without the NEP-461
 * prefix, as it sits in a `SignedDelegateAction`): from `senderId`, the NEAR
 * Receiving Address whose ed25519 key is `publicKey`, to the `usdc`
 * contract, with exactly one `ft_transfer` of `amount` (base units) to
 * `receiverId`, attaching 1 yoctoNEAR and 30 Tgas. It needs `nonce` above
 * the key's and lands up to block `maxBlockHeight`.
 */
export function nearSweepDelegateAction(input: {
  senderId: string;
  usdc: string;
  receiverId: string;
  amount: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: Uint8Array;
}): Uint8Array {
  return encodeDelegateAction({
    senderId: input.senderId,
    receiverId: input.usdc,
    actions: [
      functionCallAction({
        methodName: "ft_transfer",
        args: { receiver_id: input.receiverId, amount: input.amount },
        gas: NEAR_FT_TRANSFER_GAS,
        deposit: 1n,
      }),
    ],
    nonce: input.nonce,
    maxBlockHeight: input.maxBlockHeight,
    publicKey: input.publicKey,
  });
}

/** How a relayed Sweep's `ft_transfer` ended: it moved the USDC, or it (or the delegate) failed. */
export type NearSweepStatus = { kind: "success" } | { kind: "failure"; error: string };

/**
 * What Herald reads from a NEAR network to plan and follow Sweeps. Each
 * read rejects if the network can't be read.
 *
 * - `accessKeyNonce`: the nonce of `accountId`'s full-access key
 *   `publicKey` (ed25519, 32 bytes), null if it has no such key (the
 *   implicit account isn't created yet).
 * - `storageRegistered`: whether `accountId` is registered on the
 *   network's USDC (NEP-145 `storage_balance_of`), so it can receive USDC.
 * - `finalBlockHeight`: the latest final block's height.
 * - `sweepStatus`: how the relayer transaction `txHash` ended once it
 *   executed, null while NEAR doesn't have it executed (or doesn't know it).
 */
export type NearSweepReader = {
  accessKeyNonce(request: {
    network: NearNetwork;
    accountId: string;
    publicKey: Uint8Array;
  }): Promise<bigint | null>;
  storageRegistered(request: { network: NearNetwork; accountId: string }): Promise<boolean>;
  finalBlockHeight(request: { network: NearNetwork }): Promise<number>;
  sweepStatus(request: { network: NearNetwork; txHash: string }): Promise<NearSweepStatus | null>;
};

// Each view answers quickly; one that hangs mustn't hold up the Sweep page.
const NEAR_VIEW_TIMEOUT_MS = 8_000;

/**
 * A `NearSweepReader` over NEAR JSON-RPC at `rpcUrl`, reading state at
 * final finality. A relayer transaction's status needs its signer, which
 * `relayerOf` names (Herald's NEAR chain queue knows it). Errors never name
 * `rpcUrl`, which may carry an API key.
 *
 * `sweepStatus` asks `tx` without waiting (`wait_until: NONE`) and takes an
 * outcome only once every receipt but the gas refund ran in a final block
 * (`EXECUTED` or `FINAL`). The `ft_transfer` succeeded if no receipt failed
 * and USDC's receipt has a `SuccessValue`, the way the stock `@x402/near`
 * signer reads a settlement.
 */
export function rpcNearSweepReader(
  rpcUrl: string,
  relayerOf: (network: NearNetwork["caip2"]) => Promise<string>,
  fetchFn: typeof fetch = fetch,
): NearSweepReader {
  const rpc = nearRpcAt(fetchFn, rpcUrl, "NEAR RPC", NEAR_VIEW_TIMEOUT_MS);
  return {
    accessKeyNonce: async ({ accountId, publicKey }) => {
      const key = await viewAccessKey(rpc, accountId, `ed25519:${base58.encode(publicKey)}`);
      // A function-call key can't attach the yoctoNEAR ft_transfer needs.
      return key?.permission === "FullAccess" ? key.nonce : null;
    },
    storageRegistered: ({ network, accountId }) =>
      isStorageRegistered(rpc, network.usdc.address, accountId),
    finalBlockHeight: async () => (await finalBlock(rpc)).height,
    sweepStatus: async ({ network, txHash }) => {
      let outcome: NearOutcome | null;
      try {
        outcome = (await rpc.call("tx", {
          tx_hash: txHash,
          sender_account_id: await relayerOf(network.caip2),
          wait_until: "NONE",
        })) as NearOutcome | null;
      } catch (error) {
        if (
          error instanceof NearRpcError &&
          (error.rpcCause === "UNKNOWN_TRANSACTION" || error.rpcCause === "TIMEOUT_ERROR")
        ) {
          return null;
        }
        throw error;
      }
      const executed =
        outcome?.final_execution_status === "EXECUTED" ||
        outcome?.final_execution_status === "FINAL";
      if (!executed || outcome?.status === undefined) return null;
      const transfer = ftTransferOutcome(outcome, network.usdc.address);
      return transfer.kind === "success" ? { kind: "success" } : transfer;
    },
  };
}
