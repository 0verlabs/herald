import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import type { Network } from "../networks.ts";
import { postRpc } from "../rpc.ts";

// A NEAR Sweep is a NEP-366 delegate action from the NEAR Receiving Address
// (an implicit account) holding one USDC `ft_transfer`. The MPC signer
// signs its NEP-461 hash for the Receiving Address, and Herald's relayer
// submits it, paying the gas.
// https://github.com/near/NEPs/blob/master/neps/nep-0366.md
// https://github.com/near/NEPs/blob/master/neps/nep-0461.md

type NearNetwork = Extract<Network, { kind: "near" }>;

/** The gas a Sweep's `ft_transfer` gets: 30 Tgas, what NEP-141 wallets attach. */
export const NEAR_FT_TRANSFER_GAS = 30_000_000_000_000n;

// NEP-461's discriminant for a delegate action: 2^30 + 366.
const NEP_366_PREFIX = 2 ** 30 + 366;

const textEncoder = new TextEncoder();

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u128(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value & 0xffff_ffff_ffff_ffffn, true);
  view.setBigUint64(8, value >> 64n, true);
  return bytes;
}

function byteString(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32(bytes.length), bytes);
}

function string(value: string): Uint8Array {
  return byteString(textEncoder.encode(value));
}

// `PublicKey` and `Signature` start with their key type; 0 is ed25519.
const ED25519 = new Uint8Array([0]);
const FUNCTION_CALL_TAG = new Uint8Array([2]);

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
  const args = JSON.stringify({ receiver_id: input.receiverId, amount: input.amount });
  const ftTransfer = concatBytes(
    FUNCTION_CALL_TAG,
    string("ft_transfer"),
    byteString(textEncoder.encode(args)),
    u64(NEAR_FT_TRANSFER_GAS),
    u128(1n),
  );
  return concatBytes(
    string(input.senderId),
    string(input.usdc),
    u32(1),
    ftTransfer,
    u64(input.nonce),
    u64(input.maxBlockHeight),
    ED25519,
    input.publicKey,
  );
}

/**
 * What the sender's key signs for a delegate action (NEP-461): SHA-256 of
 * the NEP-366 prefix and the Borsh-encoded action, 32 bytes.
 */
export function nearDelegatePayloadHash(delegateAction: Uint8Array): Uint8Array {
  return sha256(concatBytes(u32(NEP_366_PREFIX), delegateAction));
}

/** A `SignedDelegateAction` (base64 Borsh): the action, then its ed25519 signature. */
export function signedNearDelegate(delegateAction: Uint8Array, signature: Uint8Array): string {
  return base64.encode(concatBytes(delegateAction, ED25519, signature));
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
  const call = async (method: string, params: object, what: string): Promise<unknown> => {
    const response = await postRpc(
      fetchFn,
      rpcUrl,
      { jsonrpc: "2.0", id: "herald", method, params },
      what,
      AbortSignal.timeout(NEAR_VIEW_TIMEOUT_MS),
    );
    const body = (await response.json()) as {
      result?: unknown;
      error?: { cause?: { name?: string } };
    };
    if (body.error) {
      throw new NearRpcAnswerError(what, body.error.cause?.name, JSON.stringify(body.error));
    }
    return body.result;
  };
  const view = async (network: NearNetwork, method: string, args: object): Promise<unknown> => {
    const result = (await call(
      "query",
      {
        request_type: "call_function",
        finality: "final",
        account_id: network.usdc.address,
        method_name: method,
        args_base64: base64.encode(textEncoder.encode(JSON.stringify(args))),
      },
      `NEAR RPC ${method}`,
    )) as { result?: unknown; error?: unknown };
    if (!Array.isArray(result?.result)) {
      throw new Error(`NEAR RPC ${method} failed: ${JSON.stringify(result?.error ?? null)}`);
    }
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result as number[])));
  };

  return {
    accessKeyNonce: async ({ accountId, publicKey }) => {
      let key: { nonce?: unknown; permission?: unknown; error?: unknown };
      try {
        key = (await call(
          "query",
          {
            request_type: "view_access_key",
            finality: "final",
            account_id: accountId,
            public_key: `ed25519:${base58.encode(publicKey)}`,
          },
          "NEAR RPC view_access_key",
        )) as typeof key;
      } catch (error) {
        // Some nodes answer a missing key or account with an error.
        if (
          error instanceof NearRpcAnswerError &&
          (error.rpcCause === "UNKNOWN_ACCESS_KEY" || error.rpcCause === "UNKNOWN_ACCOUNT")
        ) {
          return null;
        }
        throw error;
      }
      // Others answer it inside the result.
      if (typeof key?.error === "string" && /does not exist/.test(key.error)) return null;
      if (typeof key?.nonce !== "number") {
        throw new Error(`NEAR RPC view_access_key answered no nonce`);
      }
      // A function-call key can't attach the yoctoNEAR ft_transfer needs.
      if (key.permission !== "FullAccess") return null;
      return BigInt(key.nonce);
    },
    storageRegistered: async ({ network, accountId }) =>
      (await view(network, "storage_balance_of", { account_id: accountId })) !== null,
    finalBlockHeight: async () => {
      const block = (await call("block", { finality: "final" }, "NEAR RPC block")) as {
        header?: { height?: unknown };
      };
      if (typeof block?.header?.height !== "number") {
        throw new Error("NEAR RPC block answered no height");
      }
      return block.header.height;
    },
    sweepStatus: async ({ network, txHash }) => {
      let outcome: SweepOutcome;
      try {
        outcome = (await call(
          "tx",
          {
            tx_hash: txHash,
            sender_account_id: await relayerOf(network.caip2),
            wait_until: "NONE",
          },
          "NEAR RPC tx",
        )) as SweepOutcome;
      } catch (error) {
        if (
          error instanceof NearRpcAnswerError &&
          (error.rpcCause === "UNKNOWN_TRANSACTION" || error.rpcCause === "TIMEOUT_ERROR")
        ) {
          return null;
        }
        throw error;
      }
      const executed =
        outcome?.final_execution_status === "EXECUTED" ||
        outcome?.final_execution_status === "FINAL";
      if (!executed || outcome.status === undefined) return null;
      return nearSweepOutcome(outcome, network.usdc.address);
    },
  };
}

type SweepOutcome = {
  final_execution_status?: string;
  status?: { Failure?: unknown; SuccessValue?: unknown } | string;
  receipts_outcome?: { outcome?: { executor_id?: string; status?: Record<string, unknown> } }[];
};

/**
 * How a relayed Sweep ended, from its final outcome: failed if the
 * transaction or any receipt failed, else succeeded if the USDC contract's
 * receipt has a `SuccessValue`.
 */
function nearSweepOutcome(outcome: SweepOutcome, usdc: string): NearSweepStatus {
  const status = typeof outcome.status === "object" ? outcome.status : undefined;
  if (status?.Failure !== undefined) {
    return { kind: "failure", error: JSON.stringify(status.Failure) };
  }
  const receipts = outcome.receipts_outcome ?? [];
  const failed = receipts.find((r) => r.outcome?.status?.["Failure"] !== undefined);
  if (failed)
    return { kind: "failure", error: JSON.stringify(failed.outcome?.status?.["Failure"]) };
  const transfer = receipts.find((r) => r.outcome?.executor_id === usdc);
  return typeof transfer?.outcome?.status?.["SuccessValue"] === "string"
    ? { kind: "success" }
    : { kind: "failure", error: "The USDC ft_transfer receipt didn't succeed" };
}

/** A NEAR RPC error answer; `rpcCause` is the node's `cause.name`. Never names the URL. */
class NearRpcAnswerError extends Error {
  readonly rpcCause: string | undefined;

  constructor(what: string, cause: string | undefined, detail: string) {
    super(`${what} failed: ${detail}`);
    this.rpcCause = cause;
  }
}
