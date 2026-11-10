import { eip3009ABI } from "@x402/evm";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  toEventSelector,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";

type JsonRpcRequest = { id: number | string; method: string; params?: unknown[] };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string; data?: Hex } };

export type Submission = {
  hash: Hex;
  sender: Address;
  nonce: number;
  from: Address;
  to: Address;
};

/** Ways the fake chain misbehaves, set by a test before it settles. */
export type ChainFaults = {
  /** Receipts appear only this many milliseconds after the broadcast. */
  receiptDelayMs?: number;
  /** Accept the next broadcast, then forget it: never mined, never known. */
  dropNextBroadcast?: boolean;
  /** Mine the next broadcast, but answer it with an internal error. */
  loseNextBroadcastResponse?: boolean;
  /** Report a pending transaction count this many below the real one. */
  pendingCountLag?: number;
  /** Answer every call of these JSON-RPC methods with this node error. */
  rejectMethods?: { methods: string[]; message: string };
  /** Refuse connections: every request fails before reaching the node. */
  unreachable?: boolean;
};

const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
const ERROR_ABI = parseAbi(["error Error(string)"]);
const BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address, bytes32) view returns (bool)",
]);
const GWEI = 1_000_000_000n;

type Mined = { submission: Submission; raw: TransactionSerialized; minedAt: number; block: bigint };

/**
 * An in-memory EVM chain answering the JSON-RPC calls the stock x402 exact
 * mechanism and viem make while verifying and settling an EIP-3009 payment.
 * It holds one USDC contract that accepts every `transferWithAuthorization`
 * whose nonce is unused, mines each broadcast transaction at once (a reused
 * authorization mines as reverted), and records it in `submissions`. It
 * doesn't check signatures; the stock mechanism does that before anything
 * reaches the chain. `faults` makes it misbehave the way real nodes do.
 */
export class FakeEvmChain {
  readonly submissions: Submission[] = [];
  /** Broadcasts the chain accepted and then forgot (`dropNextBroadcast`). */
  readonly dropped: Submission[] = [];
  readonly faults: ChainFaults = {};
  readonly #used = new Set<string>();
  readonly #mined = new Map<Hex, Mined>();
  #block = 1000n;

  readonly chainId: number;
  readonly usdc: Address;

  constructor(chainId: number, usdc: Address) {
    this.chainId = chainId;
    this.usdc = usdc;
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      return { jsonrpc: "2.0", id: request.id, result: await this.#call(request) };
    } catch (error) {
      if (error instanceof RpcError) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: error.code, message: error.message },
        };
      }
      const failure = error as { message: string; data?: Hex };
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: 3, message: failure.message, ...(failure.data && { data: failure.data }) },
      };
    }
  }

  async #call({ method, params = [] }: JsonRpcRequest): Promise<unknown> {
    const rejected = this.faults.rejectMethods;
    if (rejected?.methods.includes(method)) throw new RpcError(-32000, rejected.message);
    switch (method) {
      case "eth_chainId":
        return numberToHex(this.chainId);
      case "eth_blockNumber":
        // A live chain: a new block every time someone polls.
        this.#block += 1n;
        return numberToHex(this.#block);
      case "eth_getCode":
        return this.#isUsdc(params[0] as Address) ? "0x6080604052" : "0x";
      case "eth_call":
        return this.#ethCall(params[0] as { to: Address; data: Hex });
      case "eth_getTransactionCount":
        return numberToHex(Math.max(0, this.#mined.size - (this.faults.pendingCountLag ?? 0)));
      case "eth_estimateGas":
        return numberToHex(100_000);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return numberToHex(GWEI);
      case "eth_getBlockByNumber":
        return this.#blockHeader();
      case "eth_sendRawTransaction":
        return this.#broadcast(params[0] as TransactionSerialized);
      case "eth_getTransactionByHash":
        return this.#transaction(params[0] as Hex);
      case "eth_getTransactionReceipt":
        return this.#receipt(params[0] as Hex);
      default:
        throw new RpcError(-32601, `the method ${method} does not exist/is not available`);
    }
  }

  #isUsdc(address: Address) {
    return address.toLowerCase() === this.usdc.toLowerCase();
  }

  #ethCall({ to, data }: { to: Address; data: Hex }): Hex {
    if (!this.#isUsdc(to)) throw new Error(`FakeEvmChain: no contract at ${to}`);
    if (data.startsWith("0x70a08231") || data.startsWith("0xe94a0102")) {
      const call = decodeFunctionData({ abi: BALANCE_ABI, data });
      if (call.functionName === "balanceOf") {
        return encodeAbiParameters([{ type: "uint256" }], [1_000_000_000n]);
      }
      const [authorizer, nonce] = call.args;
      return encodeAbiParameters([{ type: "bool" }], [this.#used.has(key(authorizer, nonce))]);
    }
    // Simulating a transfer reverts if its authorization is already used.
    const { from, nonce } = decodeTransfer(data);
    if (this.#used.has(key(from, nonce))) {
      const reason = "FiatTokenV2: authorization is used or canceled";
      throw Object.assign(new Error(`execution reverted: ${reason}`), {
        data: encodeErrorResult({ abi: ERROR_ABI, errorName: "Error", args: [reason] }),
      });
    }
    return "0x";
  }

  async #broadcast(raw: TransactionSerialized): Promise<Hex> {
    const hash = keccak256(raw);
    if (this.#mined.has(hash)) throw new RpcError(-32000, "already known");
    const transaction = parseTransaction(raw);
    if (!transaction.to || !this.#isUsdc(transaction.to) || !transaction.data) {
      throw new Error("FakeEvmChain: only USDC transfers are expected");
    }
    const sender = await recoverTransactionAddress({ serializedTransaction: raw });
    const { from, to, nonce } = decodeTransfer(transaction.data);
    const submission = { hash, sender, nonce: transaction.nonce ?? 0, from, to };

    if (this.faults.dropNextBroadcast) {
      this.faults.dropNextBroadcast = false;
      this.dropped.push(submission);
      return hash;
    }
    // Like a real node, accept the broadcast and mine it; a reused
    // authorization reverts on-chain, after Herald has paid the gas.
    this.#block += 1n;
    this.#mined.set(hash, { submission, raw, minedAt: Date.now(), block: this.#block });
    this.submissions.push(submission);
    this.#usedBefore.set(hash, this.#used.has(key(from, nonce)));
    this.#used.add(key(from, nonce));

    if (this.faults.loseNextBroadcastResponse) {
      this.faults.loseNextBroadcastResponse = false;
      throw new RpcError(-32603, "internal error");
    }
    return hash;
  }

  // Whether each mined transaction's authorization was already used, i.e.
  // whether it reverted.
  readonly #usedBefore = new Map<Hex, boolean>();

  #transaction(hash: Hex) {
    const mined = this.#mined.get(hash);
    if (!mined) return null;
    const transaction = parseTransaction(mined.raw);
    return {
      hash,
      nonce: numberToHex(transaction.nonce ?? 0),
      blockHash: keccak256(numberToHex(mined.block)),
      blockNumber: numberToHex(mined.block),
      transactionIndex: "0x0",
      from: mined.submission.sender,
      to: transaction.to,
      value: "0x0",
      gas: numberToHex(transaction.gas ?? 0n),
      maxFeePerGas: numberToHex(transaction.maxFeePerGas ?? 0n),
      maxPriorityFeePerGas: numberToHex(transaction.maxPriorityFeePerGas ?? 0n),
      input: transaction.data,
      type: "0x2",
      chainId: numberToHex(this.chainId),
      v: "0x0",
      r: pad("0x1"),
      s: pad("0x1"),
      yParity: "0x0",
      accessList: [],
    };
  }

  #receipt(hash: Hex) {
    const mined = this.#mined.get(hash);
    if (!mined || Date.now() - mined.minedAt < (this.faults.receiptDelayMs ?? 0)) return null;
    const { from, to } = mined.submission;
    const transaction = parseTransaction(mined.raw);
    const { value } = decodeTransfer(transaction.data ?? "0x");
    const reverted = this.#usedBefore.get(hash) ?? false;
    const block = numberToHex(mined.block);
    const blockHash = keccak256(block);
    return {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: block,
      from: mined.submission.sender,
      to: this.usdc,
      status: reverted ? "0x0" : "0x1",
      type: "0x2",
      gasUsed: numberToHex(80_000),
      cumulativeGasUsed: numberToHex(80_000),
      effectiveGasPrice: numberToHex(2n * GWEI),
      contractAddress: null,
      logsBloom: pad("0x", { size: 256 }),
      logs: reverted
        ? []
        : [
            {
              address: this.usdc,
              topics: [TRANSFER_TOPIC, pad(from), pad(to)],
              data: numberToHex(value, { size: 32 }),
              blockHash,
              blockNumber: block,
              transactionHash: hash,
              transactionIndex: "0x0",
              logIndex: "0x0",
              removed: false,
            },
          ],
    };
  }

  #blockHeader() {
    const number = numberToHex(this.#block);
    return {
      number,
      hash: keccak256(number),
      parentHash: pad("0x", { size: 32 }),
      timestamp: numberToHex(Math.floor(Date.now() / 1000)),
      baseFeePerGas: numberToHex(GWEI),
      gasLimit: numberToHex(30_000_000),
      gasUsed: "0x0",
      transactions: [],
    };
  }
}

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function decodeTransfer(data: Hex) {
  const call = decodeFunctionData({ abi: eip3009ABI, data });
  if (call.functionName !== "transferWithAuthorization") {
    throw new Error(`FakeEvmChain: unexpected call ${call.functionName}`);
  }
  const [from, to, value, , , nonce] = call.args;
  return { from, to, value, nonce };
}

function key(authorizer: Address, nonce: Hex) {
  return `${authorizer.toLowerCase()}:${nonce.toLowerCase()}`;
}
