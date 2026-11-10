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

const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
const ERROR_ABI = parseAbi(["error Error(string)"]);
const BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address, bytes32) view returns (bool)",
]);
const GWEI = 1_000_000_000n;

/**
 * An in-memory EVM chain answering the JSON-RPC calls the stock x402 exact
 * mechanism and viem make while verifying and settling an EIP-3009 payment.
 * It holds one USDC contract that accepts every `transferWithAuthorization`
 * whose nonce is unused, mines each broadcast transaction at once (a reused
 * authorization mines as reverted), and records it in `submissions`. It
 * doesn't check signatures; the stock mechanism does that before anything
 * reaches the chain.
 */
export class FakeEvmChain {
  readonly submissions: Submission[] = [];
  readonly #used = new Set<string>();
  readonly #receipts = new Map<Hex, Record<string, unknown>>();
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
      if (error instanceof MethodNotFound) {
        return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: error.message } };
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
    switch (method) {
      case "eth_chainId":
        return numberToHex(this.chainId);
      case "eth_blockNumber":
        return numberToHex(this.#block);
      case "eth_getCode":
        return this.#isUsdc(params[0] as Address) ? "0x6080604052" : "0x";
      case "eth_call":
        return this.#ethCall(params[0] as { to: Address; data: Hex });
      case "eth_getTransactionCount":
        return numberToHex(this.submissions.length);
      case "eth_estimateGas":
        return numberToHex(100_000);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return numberToHex(GWEI);
      case "eth_getBlockByNumber":
        return this.#blockHeader();
      case "eth_sendRawTransaction":
        return this.#mine(params[0] as TransactionSerialized);
      case "eth_getTransactionReceipt":
        return this.#receipts.get(params[0] as Hex) ?? null;
      default:
        throw new MethodNotFound(`the method ${method} does not exist/is not available`);
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

  async #mine(raw: TransactionSerialized): Promise<Hex> {
    const transaction = parseTransaction(raw);
    if (!transaction.to || !this.#isUsdc(transaction.to) || !transaction.data) {
      throw new Error("FakeEvmChain: only USDC transfers are expected");
    }
    const sender = await recoverTransactionAddress({ serializedTransaction: raw });
    // Like a real node, accept the broadcast and mine it; a reused
    // authorization reverts on-chain, after Herald has paid the gas.
    const { from, to, value, nonce } = decodeTransfer(transaction.data);
    const reverted = this.#used.has(key(from, nonce));
    this.#used.add(key(from, nonce));

    const hash = keccak256(raw);
    this.#block += 1n;
    const block = numberToHex(this.#block);
    const blockHash = keccak256(block);
    this.#receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash,
      blockNumber: block,
      from: sender,
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
    });
    this.submissions.push({ hash, sender, nonce: transaction.nonce ?? 0, from, to });
    return hash;
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

class MethodNotFound extends Error {}

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
