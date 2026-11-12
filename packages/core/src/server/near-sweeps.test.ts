import { bytesToHex } from "@noble/hashes/utils.js";
import { base64 } from "@scure/base";
import { describe, expect, test } from "vite-plus/test";
import { networkRegistry } from "../networks.ts";
import { nearDelegatePayloadHash } from "./near-protocol.ts";
import { nearSweepDelegateAction, rpcNearSweepReader } from "./near-sweeps.ts";

describe("a NEAR Sweep's delegate action", () => {
  test("hashes to the NEP-461 hash near-api-js gives the same delegate action", () => {
    // Test vector built and hashed with near-api-js 7.4 `buildDelegateAction`
    // and `sha256(encodeDelegateAction(...))` (notes, 2026-11-12).
    const delegate = nearSweepDelegateAction({
      senderId: "ab".repeat(32),
      usdc: "usdc.x",
      receiverId: "bob.testnet",
      amount: "1000",
      nonce: 7n,
      maxBlockHeight: 9n,
      publicKey: new Uint8Array(32).fill(0xab),
    });

    // The 224-byte signable form less the 4-byte NEP-461 prefix.
    expect(delegate).toHaveLength(220);
    expect(bytesToHex(nearDelegatePayloadHash(delegate))).toBe(
      "2b2cddd76827e961e4a09d7f289a6ff766f85d0ae8b76c2a852b3e93d62ab673",
    );
  });
});

const RPC_URL = "https://near.example/secret-api-key";
const nearTestnet = networkRegistry.testnet.find((n) => n.kind === "near")!;
const usdc = nearTestnet.usdc.address;
const RELAYER = "ee".repeat(32);

/** A NEAR RPC answering each request with `answer(method, params)`: a result, or `{ rpcError }`. */
function fakeRpc(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(init.body as string) as {
      method: string;
      params: Record<string, unknown>;
    };
    calls.push({ method, params });
    const answered = answer(method, params) as { rpcError?: unknown };
    const body =
      answered && typeof answered === "object" && "rpcError" in answered
        ? { jsonrpc: "2.0", id: "herald", error: answered.rpcError }
        : { jsonrpc: "2.0", id: "herald", result: answered };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return {
    calls,
    reader: rpcNearSweepReader(RPC_URL, async () => RELAYER, fetchFn),
  };
}

const viewResult = (value: unknown) => ({
  result: [...new TextEncoder().encode(JSON.stringify(value))],
  logs: [],
});

const handlerError = (cause: string) => ({
  rpcError: { name: "HANDLER_ERROR", cause: { name: cause, info: {} }, code: -32000 },
});

/** A relayed Sweep's outcome as `tx` reports it, its `ft_transfer` receipt ending with `transfer`. */
function outcome(finalExecutionStatus: string, transfer: object, status: object = {}) {
  return {
    final_execution_status: finalExecutionStatus,
    status: { SuccessValue: "", ...status },
    receipts_outcome: [
      { outcome: { executor_id: "a".repeat(64), status: { SuccessReceiptId: "x" } } },
      { outcome: { executor_id: usdc, status: transfer } },
      { outcome: { executor_id: RELAYER, status: { SuccessValue: "" } } },
    ],
  };
}

describe("reading NEAR for Sweeps over RPC", () => {
  const account = "ab".repeat(32);
  const publicKey = new Uint8Array(32).fill(0xab);

  test("reads a full-access key's nonce at final finality, and none for a missing or function-call key", async () => {
    const answers = [
      { nonce: 7, permission: "FullAccess" },
      { error: "access key ed25519:… does not exist while viewing", logs: [] },
      { nonce: 7, permission: { FunctionCall: { receiver_id: usdc } } },
      handlerError("UNKNOWN_ACCOUNT"),
    ];
    const { calls, reader } = fakeRpc(() => answers.shift());
    const read = () =>
      reader.accessKeyNonce({ network: nearTestnet, accountId: account, publicKey });

    expect([await read(), await read(), await read(), await read()]).toEqual([
      7n,
      null,
      null,
      null,
    ]);
    expect(calls[0]).toEqual({
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "final",
        account_id: account,
        public_key: "ed25519:CZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9t",
      },
    });
  });

  test("reads whether an account is registered on USDC", async () => {
    const answers = [
      viewResult({ total: "1250000000000000000000", available: "0" }),
      viewResult(null),
    ];
    const { calls, reader } = fakeRpc(() => answers.shift());
    const read = () => reader.storageRegistered({ network: nearTestnet, accountId: "bob.testnet" });

    expect([await read(), await read()]).toEqual([true, false]);
    expect(calls[0]?.params).toMatchObject({
      request_type: "call_function",
      finality: "final",
      account_id: usdc,
      method_name: "storage_balance_of",
      args_base64: base64.encode(new TextEncoder().encode('{"account_id":"bob.testnet"}')),
    });
  });

  test("reads a relayed Sweep's outcome only once it executed in final blocks, asking as the relayer", async () => {
    const answers = [
      handlerError("UNKNOWN_TRANSACTION"),
      outcome("EXECUTED_OPTIMISTIC", { SuccessValue: "" }),
      outcome("FINAL", { SuccessValue: "" }),
      outcome(
        "EXECUTED",
        {
          Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "panicked" } } } },
        },
        { Failure: {} },
      ),
    ];
    const { calls, reader } = fakeRpc(() => answers.shift());
    const read = () => reader.sweepStatus({ network: nearTestnet, txHash: "tx" });

    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
    expect(await read()).toEqual({ kind: "success" });
    expect(await read()).toMatchObject({ kind: "failure" });
    expect(calls[0]).toEqual({
      method: "tx",
      params: { tx_hash: "tx", sender_account_id: RELAYER, wait_until: "NONE" },
    });
  });

  test("reads the final block height", async () => {
    const { reader } = fakeRpc(() => ({ header: { height: 277_354_969, hash: "h" } }));

    expect(await reader.finalBlockHeight({ network: nearTestnet })).toBe(277_354_969);
  });

  test("never names the endpoint in its errors", async () => {
    const fetchFn = (async () => {
      throw new TypeError(`fetch to ${RPC_URL} failed`);
    }) as typeof fetch;
    const reader = rpcNearSweepReader(RPC_URL, async () => RELAYER, fetchFn);

    const error = await reader.finalBlockHeight({ network: nearTestnet }).catch((e: unknown) => e);

    expect(String(error)).not.toContain("secret-api-key");
  });
});
