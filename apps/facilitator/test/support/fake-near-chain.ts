import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base58, base64 } from "@scure/base";
import {
  decodeSignedTransaction,
  encodeDelegateAction,
  encodeTransaction,
  type DelegateAction,
} from "near-api-js";

// The fake decodes what Herald sends with near-api-js, a Borsh
// implementation independent of Herald's own encoder.

type JsonRpcRequest = { id: number | string; method: string; params?: unknown };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: NearRpcErrorBody };
type NearRpcErrorBody = {
  name: string;
  cause: { name: string; info: unknown };
  code: number;
  message: string;
  data: unknown;
};

/** A USDC `ft_transfer` that landed, from a relayed delegate action. */
export type NearTransfer = {
  /** The relayer transaction's hash. */
  txHash: string;
  relayer: string;
  relayerNonce: bigint;
  /** The delegate's sender: the Buyer. */
  sender: string;
  receiver: string;
  amount: bigint;
};

/** A NEAR transfer that landed: from the relayer, creating `receiver` if it didn't exist. */
export type NearNativeTransfer = {
  txHash: string;
  relayer: string;
  receiver: string;
  /** yoctoNEAR. */
  amount: bigint;
  /** Whether the transfer created `receiver`, an implicit account. */
  createdAccount: boolean;
};

/** A `storage_deposit` on USDC that landed (NEP-145). */
export type NearStorageDeposit = {
  txHash: string;
  relayer: string;
  /** The account it registers. */
  account: string;
  /** yoctoNEAR attached. */
  deposit: bigint;
};

/** An MPC `sign` call that landed from a relayed delegate action (a sponsored Sweep). */
export type NearSponsoredSign = {
  txHash: string;
  relayer: string;
  /** The delegate's sender: the Provider Account, the `sign` caller. */
  sender: string;
  /** The `sign` call's `request` argument. */
  request: unknown;
  gas: bigint;
  deposit: bigint;
};

/** Ways the fake NEAR RPC misbehaves, set by a test. */
export type NearChainFaults = {
  /** A sent transaction is final only this many milliseconds after it lands. */
  finalityDelayMs?: number;
  /** Fail this many upcoming requests of any method with a server error. */
  failNextRequests?: number;
  /** Answer this many upcoming `send_tx` with a server error, without taking the transaction. */
  failNextBroadcasts?: number;
  /** Fail this many upcoming view calls (`call_function`) of each contract method, by name. */
  failNextCalls?: Record<string, number>;
  /** Fail this many upcoming access key reads (`view_access_key`) with a server error. */
  failNextKeyReads?: number;
  /** Refuse connections: every request fails before reaching the node. */
  unreachable?: boolean;
};

type Account = { amount: bigint; codeHash: string };
type AccessKey = { nonce: bigint; permission: "FullAccess" | { FunctionCall: unknown } };
type Landed = { at: number; outcome: unknown };

const EMPTY_CODE_HASH = "11111111111111111111111111111111";
const START_HEIGHT = 200_000_000n;
// Gas a relayer transaction holding one delegate burns, roughly.
const TOKENS_BURNT = "250000000000000000000";
// USDC's `storage_balance_bounds` on testnet and mainnet: 0.00125 NEAR.
const STORAGE_MIN = 1_250_000_000_000_000_000_000n;

class RpcFailure extends Error {
  readonly cause: string;
  readonly info: unknown;

  constructor(cause: string, message: string, info: unknown = {}) {
    super(message);
    this.cause = cause;
    this.info = info;
  }
}

/**
 * An in-memory NEAR network answering the JSON-RPC calls Herald's
 * facilitator, its `NearChainQueue` and the MPC root-key check make: `block`,
 * `query` (`view_account`, `view_access_key`, and `call_function` on the USDC
 * contract and the MPC signer), `send_tx` and `tx`.
 *
 * It models accounts, access keys and their nonces, USDC balances and
 * storage registration (NEP-141 / NEP-145). A relayer transaction holding a
 * Buyer's signed delegate action lands only with a valid relayer signature,
 * a relayer nonce above its key's, and a known block hash; the delegate
 * needs a valid NEP-461 signature by a full-access key of its sender, a
 * nonce above that key's, and a `max_block_height` not passed. Its
 * `ft_transfer` then moves USDC, or fails (as the contract panics) when the
 * receiver isn't registered or the sender lacks the balance. Each block
 * query advances the height by one. A delegate action holding one `sign`
 * call to the MPC signer (a sponsored Sweep) lands too, recorded in
 * `sponsoredSigns`, with the MPC signer's answer in its receipts.
 *
 * A relayer transaction can instead hold one `Transfer` (creating an
 * implicit account that doesn't exist yet) or one `storage_deposit` call on
 * USDC, as setting up a Provider's NEAR Receiving Address sends.
 *
 * It records landed USDC transfers in `transfers`, NEAR transfers in
 * `nearTransfers` and `storage_deposit` calls in `storageDeposits`.
 */
export class FakeNearChain {
  readonly transfers: NearTransfer[] = [];
  readonly nearTransfers: NearNativeTransfer[] = [];
  readonly storageDeposits: NearStorageDeposit[] = [];
  readonly sponsoredSigns: NearSponsoredSign[] = [];
  readonly faults: NearChainFaults = {};
  readonly usdc: string;
  /** What `public_key({ domain_id })` answers on the MPC signer contract. */
  readonly mpcRootKeys: Record<number, string>;
  readonly #mpcContract: string;
  readonly #accounts = new Map<string, Account>();
  readonly #keys = new Map<string, AccessKey>();
  readonly #usdcBalances = new Map<string, bigint>();
  readonly #registered = new Set<string>();
  readonly #blocks = new Map<string, bigint>();
  readonly #landed = new Map<string, Landed>();
  #height = START_HEIGHT;

  constructor(options: { usdc: string; mpcContract: string; mpcRootKeys: Record<number, string> }) {
    this.usdc = options.usdc;
    this.#mpcContract = options.mpcContract;
    this.mpcRootKeys = options.mpcRootKeys;
    this.#accounts.set(this.usdc, { amount: 0n, codeHash: "usdc-code-hash" });
  }

  /**
   * Creates an account holding `near` yoctoNEAR with a full-access key, as
   * a transfer to an implicit account does (its key nonce starts at the
   * creation height × 10^6).
   */
  addAccount(accountId: string, publicKey: string, near = 10n ** 24n): void {
    this.#accounts.set(accountId, { amount: near, codeHash: EMPTY_CODE_HASH });
    this.#keys.set(keyId(accountId, publicKey), {
      nonce: this.#height * 1_000_000n,
      permission: "FullAccess",
    });
  }

  /** Gives `accountId` another access key, such as a function-call key. */
  addAccessKey(accountId: string, publicKey: string, permission: AccessKey["permission"]): void {
    this.#keys.set(keyId(accountId, publicKey), { nonce: this.#height * 1_000_000n, permission });
  }

  /** `accountId`'s NEAR balance in yoctoNEAR, 0 if it doesn't exist. */
  nearBalanceOf(accountId: string): bigint {
    return this.#accounts.get(accountId)?.amount ?? 0n;
  }

  /** Gives `accountId` a USDC balance, storage-registering it. */
  fundUsdc(accountId: string, amount: bigint): void {
    this.#registered.add(accountId);
    this.#usdcBalances.set(accountId, (this.#usdcBalances.get(accountId) ?? 0n) + amount);
  }

  /** Registers `accountId` on USDC (`storage_deposit`), as if done before the test. */
  registerStorage(accountId: string): void {
    this.#registered.add(accountId);
  }

  hasAccount(accountId: string): boolean {
    return this.#accounts.has(accountId);
  }

  isRegistered(accountId: string): boolean {
    return this.#registered.has(accountId);
  }

  usdcBalanceOf(accountId: string): bigint {
    return this.#usdcBalances.get(accountId) ?? 0n;
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if ((this.faults.failNextRequests ?? 0) > 0) {
      this.faults.failNextRequests = (this.faults.failNextRequests ?? 0) - 1;
      return rpcError(request, new RpcFailure("INTERNAL_ERROR", "Internal server error"));
    }
    try {
      return { jsonrpc: "2.0", id: request.id, result: this.#call(request) };
    } catch (error) {
      if (error instanceof RpcFailure) return rpcError(request, error);
      throw error;
    }
  }

  #call({ method, params }: JsonRpcRequest): unknown {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "block":
        return this.#block(p);
      case "query":
        return this.#query(p);
      case "send_tx":
        if ((this.faults.failNextBroadcasts ?? 0) > 0) {
          this.faults.failNextBroadcasts = (this.faults.failNextBroadcasts ?? 0) - 1;
          throw new RpcFailure("INTERNAL_ERROR", "Internal server error");
        }
        return this.#send(
          String(p["signed_tx_base64"]),
          typeof p["wait_until"] === "string" ? p["wait_until"] : "EXECUTED_OPTIMISTIC",
        );
      case "tx":
        return this.#status(String(p["tx_hash"]));
      default:
        throw new Error(`FakeNearChain: the method ${method} is not faked`);
    }
  }

  #block(params: Record<string, unknown>) {
    if (params["finality"] !== "final") {
      throw new Error("FakeNearChain: Herald reads blocks at final finality");
    }
    this.#height += 1n;
    const hash = base58.encode(sha256(new TextEncoder().encode(`block ${this.#height}`)));
    this.#blocks.set(hash, this.#height);
    return { header: { height: Number(this.#height), hash, timestamp: Date.now() * 1e6 } };
  }

  #query(params: Record<string, unknown>): unknown {
    if (params["finality"] !== "final") {
      throw new Error("FakeNearChain: Herald reads state at final finality");
    }
    const accountId = String(params["account_id"]);
    const at = { block_height: Number(this.#height), block_hash: "fake" };
    switch (params["request_type"]) {
      case "view_account": {
        const account = this.#accounts.get(accountId);
        if (!account) {
          throw new RpcFailure(
            "UNKNOWN_ACCOUNT",
            `account ${accountId} does not exist while viewing`,
            {
              requested_account_id: accountId,
            },
          );
        }
        return {
          amount: account.amount.toString(),
          locked: "0",
          code_hash: account.codeHash,
          storage_usage: 182,
          storage_paid_at: 0,
          ...at,
        };
      }
      case "view_access_key": {
        if ((this.faults.failNextKeyReads ?? 0) > 0) {
          this.faults.failNextKeyReads = (this.faults.failNextKeyReads ?? 0) - 1;
          throw new RpcFailure("INTERNAL_ERROR", "Internal server error");
        }
        const key = this.#keys.get(keyId(accountId, String(params["public_key"])));
        // As the RPC answers a missing key: inside `result`, no top-level error.
        if (!key) {
          return {
            error: `access key ${String(params["public_key"])} does not exist while viewing`,
            logs: [],
            ...at,
          };
        }
        return { nonce: Number(key.nonce), permission: key.permission, ...at };
      }
      case "call_function": {
        const method = String(params["method_name"]);
        const failures = this.faults.failNextCalls?.[method] ?? 0;
        if (failures > 0) {
          this.faults.failNextCalls = { ...this.faults.failNextCalls, [method]: failures - 1 };
          throw new RpcFailure("INTERNAL_ERROR", "Internal server error");
        }
        return this.#view(
          accountId,
          String(params["method_name"]),
          JSON.parse(new TextDecoder().decode(base64.decode(String(params["args_base64"])))),
          at,
        );
      }
      default:
        throw new Error(`FakeNearChain: query ${String(params["request_type"])} is not faked`);
    }
  }

  #view(contract: string, method: string, args: Record<string, unknown>, at: object) {
    const answer = (value: unknown) => ({
      result: [...new TextEncoder().encode(JSON.stringify(value))],
      logs: [],
      ...at,
    });
    if (contract === this.#mpcContract && method === "public_key") {
      return answer(this.mpcRootKeys[Number(args["domain_id"])]);
    }
    if (contract === this.usdc) {
      const accountId = String(args["account_id"]);
      if (method === "ft_balance_of") return answer(this.usdcBalanceOf(accountId).toString());
      if (method === "storage_balance_of") {
        return answer(
          this.#registered.has(accountId)
            ? { total: "1250000000000000000000", available: "0" }
            : null,
        );
      }
    }
    throw new Error(`FakeNearChain: ${contract}.${method} is not faked`);
  }

  // Validates and lands a relayer transaction at once, as `send_tx` with
  // `wait_until: NONE` takes it. A transaction it already has is accepted
  // again without landing twice.
  #send(signedTxBase64: string, waitUntil: string): unknown {
    const signed = decodeSignedTransaction(base64.decode(signedTxBase64));
    const { transaction } = signed;
    const message = encodeTransaction(transaction);
    const hash = base58.encode(sha256(message));
    if (this.#landed.has(hash)) return this.#sendAnswer(hash, waitUntil);

    const signerKey = publicKeyString(transaction.publicKey);
    const key = this.#keys.get(keyId(transaction.signerId, signerKey));
    if (!key) throw invalidTransaction({ InvalidAccessKeyError: { AccessKeyNotFound: {} } });
    if (
      !ed25519.verify(
        signatureBytes(signed.signature),
        sha256(message),
        keyBytes(transaction.publicKey),
      )
    ) {
      throw invalidTransaction("InvalidSignature");
    }
    if (transaction.nonce <= key.nonce) {
      throw invalidTransaction({
        InvalidNonce: { tx_nonce: Number(transaction.nonce), ak_nonce: Number(key.nonce) },
      });
    }
    if (!this.#blocks.has(base58.encode(new Uint8Array(transaction.blockHash)))) {
      throw invalidTransaction("InvalidChain");
    }
    const [action, ...rest] = transaction.actions;
    if (!action || rest.length > 0) {
      throw new Error("FakeNearChain: Herald's relayer sends one action per transaction");
    }
    const { signerId, receiverId } = transaction;
    const deposit = BigInt(action.transfer?.deposit ?? action.functionCall?.deposit ?? 0n);
    const signer = this.#accounts.get(signerId);
    if (!signer || signer.amount < deposit) {
      throw invalidTransaction({ NotEnoughBalance: { signer_id: signerId } });
    }
    key.nonce = transaction.nonce;

    let outcome: unknown;
    if (action.signedDelegate) {
      if (receiverId !== action.signedDelegate.delegateAction.senderId) {
        throw new Error("FakeNearChain: a Delegate goes to its sender");
      }
      outcome = this.#runDelegate(hash, signerId, transaction.nonce, action.signedDelegate);
    } else if (action.transfer) {
      outcome = this.#runTransfer(hash, signerId, receiverId, deposit);
    } else if (action.functionCall) {
      outcome = this.#runCall(hash, signerId, receiverId, action.functionCall);
    } else {
      throw new Error("FakeNearChain: Herald's relayer sends Delegate, Transfer or FunctionCall");
    }
    this.#landed.set(hash, { at: Date.now(), outcome });
    return this.#sendAnswer(hash, waitUntil);
  }

  // A Transfer from the relayer. One to a missing implicit account creates
  // it, with the full-access key its id names; one to a missing named
  // account fails.
  #runTransfer(txHash: string, relayer: string, receiver: string, amount: bigint) {
    const existing = this.#accounts.get(receiver);
    if (!existing && !/^[0-9a-f]{64}$/.test(receiver)) {
      return simpleOutcome(txHash, relayer, receiver, {
        error: { AccountDoesNotExist: { account_id: receiver } },
      });
    }
    this.#debit(relayer, amount);
    if (existing) {
      existing.amount += amount;
    } else {
      this.addAccount(receiver, `ed25519:${base58.encode(hexToBytes(receiver))}`, amount);
    }
    this.nearTransfers.push({ txHash, relayer, receiver, amount, createdAccount: !existing });
    return simpleOutcome(txHash, relayer, receiver, {});
  }

  // A FunctionCall from the relayer: only `storage_deposit` on USDC.
  #runCall(
    txHash: string,
    relayer: string,
    contract: string,
    call: { methodName: string; args: ArrayLike<number>; deposit: bigint | string | number },
  ) {
    if (contract !== this.usdc || call.methodName !== "storage_deposit") {
      throw new Error(`FakeNearChain: ${contract}.${call.methodName} calls are not faked`);
    }
    const args = JSON.parse(new TextDecoder().decode(new Uint8Array(Array.from(call.args)))) as {
      account_id?: string;
      registration_only?: boolean;
    };
    const account = args.account_id ?? relayer;
    const deposit = BigInt(call.deposit);
    if (!this.#registered.has(account) && deposit < STORAGE_MIN) {
      return simpleOutcome(txHash, relayer, contract, {
        error: {
          FunctionCallError: {
            ExecutionError:
              "Smart contract panicked: The attached deposit is less than the minimum storage balance",
          },
        },
      });
    }
    // With `registration_only`, an account already registered gets the
    // deposit back; a new one keeps the minimum and gets the rest back.
    const kept = this.#registered.has(account) ? 0n : STORAGE_MIN;
    this.#debit(relayer, args.registration_only ? kept : deposit);
    this.#registered.add(account);
    this.storageDeposits.push({ txHash, relayer, account, deposit });
    const balance = { total: STORAGE_MIN.toString(), available: "0" };
    return simpleOutcome(txHash, relayer, contract, {
      value: base64.encode(new TextEncoder().encode(JSON.stringify(balance))),
    });
  }

  #debit(accountId: string, amount: bigint): void {
    const account = this.#accounts.get(accountId);
    if (account) account.amount -= amount;
  }

  #sendAnswer(hash: string, waitUntil: string) {
    if (waitUntil === "NONE") return { final_execution_status: "NONE" };
    return this.#status(hash);
  }

  #runDelegate(
    txHash: string,
    relayer: string,
    relayerNonce: bigint,
    signed: { delegateAction: DelegateAction; signature: unknown },
  ) {
    const delegate = signed.delegateAction;
    const sender = delegate.senderId;
    const failure = (error: unknown) => outcomeOf(txHash, relayer, sender, this.usdc, { error });
    const senderKey = this.#keys.get(keyId(sender, publicKeyString(delegate.publicKey)));
    if (!senderKey) {
      return failure({ DelegateActionAccessKeyError: { AccessKeyNotFound: {} } });
    }
    const [first] = delegate.actions;
    const deposit = BigInt(first?.functionCall?.deposit ?? 0n);
    if (senderKey.permission !== "FullAccess" && deposit > 0n) {
      return failure({ DelegateActionAccessKeyError: "DepositWithFunctionCall" });
    }
    const signedHash = sha256(encodeDelegateAction(delegate));
    if (
      !ed25519.verify(signatureBytes(signed.signature), signedHash, keyBytes(delegate.publicKey))
    ) {
      return failure("DelegateActionInvalidSignature");
    }
    if (delegate.maxBlockHeight < this.#height) {
      return failure({ DelegateActionExpired: {} });
    }
    if (delegate.nonce <= senderKey.nonce) {
      return failure({ DelegateActionInvalidNonce: { delegate_nonce: Number(delegate.nonce) } });
    }
    senderKey.nonce = delegate.nonce;

    const [inner] = delegate.actions;
    const call = inner?.functionCall;
    if (delegate.receiverId === this.#mpcContract && call?.methodName === "sign") {
      return this.#runSign(txHash, relayer, sender, call);
    }
    if (delegate.receiverId !== this.usdc || call?.methodName !== "ft_transfer") {
      throw new Error("FakeNearChain: only USDC ft_transfer delegates are expected");
    }
    const args = JSON.parse(new TextDecoder().decode(new Uint8Array(call.args))) as {
      receiver_id: string;
      amount: string;
    };
    const amount = BigInt(args.amount);
    const panic = (reason: string) =>
      outcomeOf(txHash, relayer, sender, this.usdc, {
        error: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${reason}` } },
        onToken: true,
      });
    if (BigInt(call.deposit) !== 1n)
      return panic("Requires attached deposit of exactly 1 yoctoNEAR");
    if (!this.#registered.has(args.receiver_id)) {
      return panic(`The account ${args.receiver_id} is not registered`);
    }
    if (this.usdcBalanceOf(sender) < amount)
      return panic("The account doesn't have enough balance");
    this.#usdcBalances.set(sender, this.usdcBalanceOf(sender) - amount);
    this.#usdcBalances.set(args.receiver_id, this.usdcBalanceOf(args.receiver_id) + amount);
    this.transfers.push({
      txHash,
      relayer,
      relayerNonce,
      sender,
      receiver: args.receiver_id,
      amount,
    });
    return outcomeOf(txHash, relayer, sender, this.usdc, {});
  }

  // A relayed MPC `sign` call from `sender`: the MPC signer answers with a
  // signature (any 64 bytes stand in for it), the relayer paying the
  // 1 yoctoNEAR deposit and the gas, as on testnet (#46).
  #runSign(
    txHash: string,
    relayer: string,
    sender: string,
    call: {
      args: ArrayLike<number>;
      gas: bigint | string | number;
      deposit: bigint | string | number;
    },
  ) {
    const args = JSON.parse(new TextDecoder().decode(new Uint8Array(Array.from(call.args)))) as {
      request?: unknown;
    };
    this.#debit(relayer, BigInt(call.deposit));
    this.sponsoredSigns.push({
      txHash,
      relayer,
      sender,
      request: args.request,
      gas: BigInt(call.gas),
      deposit: BigInt(call.deposit),
    });
    const answer = { scheme: "Ed25519", signature: Array.from(new Uint8Array(64), () => 7) };
    return signOutcome(txHash, relayer, sender, this.#mpcContract, answer);
  }

  // `tx` as the RPC answers a final transaction; before it is final (or for
  // one it never got), the error the RPC gives while waiting.
  #status(hash: string): unknown {
    const landed = this.#landed.get(hash);
    if (!landed) throw new RpcFailure("UNKNOWN_TRANSACTION", `Transaction ${hash} doesn't exist`);
    if (Date.now() - landed.at < (this.faults.finalityDelayMs ?? 0)) {
      throw new RpcFailure("TIMEOUT_ERROR", "Timeout");
    }
    return landed.outcome;
  }
}

function keyId(accountId: string, publicKey: string): string {
  return `${accountId}/${publicKey}`;
}

type BorshPublicKey = { ed25519Key?: { data: ArrayLike<number> } };
type BorshSignature = { ed25519Signature?: { data: ArrayLike<number> } };

function keyBytes(publicKey: unknown): Uint8Array {
  const data = (publicKey as BorshPublicKey).ed25519Key?.data;
  if (!data) throw new Error("FakeNearChain: only ed25519 keys are expected");
  return new Uint8Array(Array.from(data));
}

function publicKeyString(publicKey: unknown): string {
  return `ed25519:${base58.encode(keyBytes(publicKey))}`;
}

function signatureBytes(signature: unknown): Uint8Array {
  const data = (signature as BorshSignature).ed25519Signature?.data;
  if (!data) throw new Error("FakeNearChain: only ed25519 signatures are expected");
  return new Uint8Array(Array.from(data));
}

function invalidTransaction(reason: unknown): RpcFailure {
  return new RpcFailure("INVALID_TRANSACTION", "Invalid transaction", {
    TxExecutionError: { InvalidTxError: reason },
  });
}

function rpcError(request: JsonRpcRequest, failure: RpcFailure): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: request.id,
    error: {
      name: "HANDLER_ERROR",
      cause: { name: failure.cause, info: failure.info },
      code: -32000,
      message: "Server error",
      data: failure.message,
    },
  };
}

/**
 * A final relayer transaction as `tx` reports it: the relayer's
 * transaction, the Delegate receipt on the sender, the `ft_transfer` receipt
 * on USDC, and the gas refund. `error` fails the Delegate receipt, or with
 * `onToken` the `ft_transfer` one (a contract panic).
 */
function outcomeOf(
  txHash: string,
  relayer: string,
  sender: string,
  usdc: string,
  { error, onToken = false }: { error?: unknown; onToken?: boolean },
) {
  const id = (n: number) => base58.encode(sha256(new TextEncoder().encode(`${txHash}/${n}`)));
  const failure = error === undefined ? undefined : { ActionError: { index: 0, kind: error } };
  const receipt = (n: number, executor: string, status: unknown, logs: string[] = []) => ({
    id: id(n),
    outcome: {
      executor_id: executor,
      status,
      logs,
      receipt_ids: [],
      gas_burnt: 1,
      tokens_burnt: "0",
    },
  });
  const receipts = [
    receipt(1, sender, onToken || !failure ? { SuccessReceiptId: id(2) } : { Failure: failure }),
  ];
  if (onToken || !failure) {
    receipts.push(
      receipt(
        2,
        usdc,
        failure ? { Failure: failure } : { SuccessValue: "" },
        failure ? [] : [`EVENT_JSON:{"standard":"nep141","event":"ft_transfer"}`],
      ),
    );
  }
  receipts.push(receipt(3, relayer, { SuccessValue: "" }));
  return {
    final_execution_status: "FINAL",
    status: failure ? { Failure: failure } : { SuccessValue: "" },
    transaction: { hash: txHash, signer_id: relayer, receiver_id: sender, actions: [] },
    transaction_outcome: {
      id: txHash,
      outcome: {
        executor_id: relayer,
        status: { SuccessReceiptId: id(1) },
        logs: [],
        receipt_ids: [id(1)],
        gas_burnt: 1,
        tokens_burnt: TOKENS_BURNT,
      },
    },
    receipts_outcome: receipts,
  };
}

/**
 * A final relayer transaction holding a delegate action with one MPC `sign`
 * call, as `tx` reported it on testnet (#46): the top-level status is the
 * delegate receipt's empty `SuccessValue`, the MPC signer's first receipt
 * yields, and its second answers the signature.
 */
function signOutcome(
  txHash: string,
  relayer: string,
  sender: string,
  mpcContract: string,
  answer: unknown,
) {
  const id = (n: number) => base58.encode(sha256(new TextEncoder().encode(`${txHash}/${n}`)));
  const receipt = (n: number, executor: string, status: unknown) => ({
    id: id(n),
    outcome: {
      executor_id: executor,
      status,
      logs: [],
      receipt_ids: [],
      gas_burnt: 1,
      tokens_burnt: "0",
    },
  });
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: { hash: txHash, signer_id: relayer, receiver_id: sender, actions: [] },
    transaction_outcome: {
      id: txHash,
      outcome: {
        executor_id: relayer,
        status: { SuccessReceiptId: id(1) },
        logs: [],
        receipt_ids: [id(1)],
        gas_burnt: 1,
        tokens_burnt: TOKENS_BURNT,
      },
    },
    receipts_outcome: [
      receipt(1, sender, { SuccessValue: "" }),
      receipt(2, mpcContract, { SuccessReceiptId: id(3) }),
      receipt(3, mpcContract, {
        SuccessValue: base64.encode(new TextEncoder().encode(JSON.stringify(answer))),
      }),
      receipt(4, relayer, { SuccessValue: "" }),
    ],
  };
}

/**
 * A final relayer transaction holding one Transfer or FunctionCall, as `tx`
 * reports it: the receipt on `receiver`, failed with `error` or succeeding
 * with `value`, and the gas refund.
 */
function simpleOutcome(
  txHash: string,
  relayer: string,
  receiver: string,
  { error, value = "" }: { error?: unknown; value?: string },
) {
  const id = (n: number) => base58.encode(sha256(new TextEncoder().encode(`${txHash}/${n}`)));
  const failure = error === undefined ? undefined : { ActionError: { index: 0, kind: error } };
  const status = failure ? { Failure: failure } : { SuccessValue: value };
  const receipt = (n: number, executor: string, receiptStatus: unknown) => ({
    id: id(n),
    outcome: {
      executor_id: executor,
      status: receiptStatus,
      logs: [],
      receipt_ids: [],
      gas_burnt: 1,
      tokens_burnt: "0",
    },
  });
  return {
    final_execution_status: "FINAL",
    status,
    transaction: { hash: txHash, signer_id: relayer, receiver_id: receiver, actions: [] },
    transaction_outcome: {
      id: txHash,
      outcome: {
        executor_id: relayer,
        status: { SuccessReceiptId: id(1) },
        logs: [],
        receipt_ids: [id(1)],
        gas_burnt: 1,
        tokens_burnt: TOKENS_BURNT,
      },
    },
    receipts_outcome: [receipt(1, receiver, status), receipt(2, relayer, { SuccessValue: "" })],
  };
}
