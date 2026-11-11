import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  AssociatedTokenInstruction,
  findAssociatedTokenPda,
  getMintEncoder,
  getTokenEncoder,
  identifyAssociatedTokenInstruction,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getTransactionDecoder,
  none,
  verifySignature,
  type Address,
  type ReadonlyUint8Array,
  type Transaction,
} from "@solana/kit";

type JsonRpcRequest = { id: number | string; method: string; params?: unknown[] };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string } };

/** A USDC transfer that landed. */
export type SolanaTransfer = {
  signature: string;
  feePayer: Address;
  /** The token account owner who signed the transfer: the Buyer. */
  authority: Address;
  destination: Address;
  amount: bigint;
};

/** A token account created by a transaction that landed. */
export type TokenAccountCreation = {
  signature: string;
  feePayer: Address;
  owner: Address;
  tokenAccount: Address;
};

/** Ways the fake chain misbehaves, set by a test. */
export type SolanaChainFaults = {
  /** Signature statuses appear only this many milliseconds after the send. */
  confirmationDelayMs?: number;
  /** Fail this many upcoming requests of any method with a server error. */
  failNextRequests?: number;
  /** Refuse connections: every request fails before reaching the node. */
  unreachable?: boolean;
};

const SLOT = 400_000_000;

/**
 * An in-memory Solana cluster answering the JSON-RPC calls the stock x402
 * exact mechanism, its Buyer client and Herald's Solana chain queue make. It
 * holds one USDC mint. Every Buyer's USDC token account is funded; any other
 * token account exists only once `createTokenAccount` or a landed
 * create-associated-token-account instruction made it. Sent transactions
 * land at once if every signature is valid, and land once per signature, as
 * on a real cluster; sent with preflight, one that would fail is refused
 * instead. It records USDC transfers in `transfers` and token account
 * creations in `tokenAccountCreations`.
 */
export class FakeSolanaChain {
  readonly transfers: SolanaTransfer[] = [];
  readonly tokenAccountCreations: TokenAccountCreation[] = [];
  readonly faults: SolanaChainFaults = {};
  readonly usdc: Address;
  /** Every token account that exists, by address, with its owner. */
  readonly #tokenAccounts = new Map<Address, Address>();
  /** Landed transactions by signature, with when they landed. */
  readonly #landed = new Map<string, { at: number; err: unknown }>();

  constructor(usdc: string) {
    this.usdc = address(usdc);
  }

  /** Creates `owner`'s USDC token account, as if it existed before the test. */
  async createTokenAccount(owner: string): Promise<Address> {
    const tokenAccount = await this.tokenAccountOf(owner);
    this.#tokenAccounts.set(tokenAccount, address(owner));
    return tokenAccount;
  }

  async hasTokenAccount(owner: string): Promise<boolean> {
    return this.#tokenAccounts.has(await this.tokenAccountOf(owner));
  }

  async tokenAccountOf(owner: string): Promise<Address> {
    const [tokenAccount] = await findAssociatedTokenPda({
      owner: address(owner),
      mint: this.usdc,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return tokenAccount;
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if ((this.faults.failNextRequests ?? 0) > 0) {
      this.faults.failNextRequests = (this.faults.failNextRequests ?? 0) - 1;
      return { jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "internal error" } };
    }
    try {
      return { jsonrpc: "2.0", id: request.id, result: await this.#call(request) };
    } catch (error) {
      if (error instanceof PreflightFailure) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32002,
            message: "Transaction simulation failed",
            data: { err: error.err, logs: [], accounts: null, unitsConsumed: 0, returnData: null },
          },
        } as JsonRpcResponse;
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async #call({ method, params = [] }: JsonRpcRequest): Promise<unknown> {
    const context = { slot: SLOT };
    switch (method) {
      case "getLatestBlockhash":
        return {
          context,
          value: {
            blockhash: getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32))),
            lastValidBlockHeight: SLOT + 150,
          },
        };
      case "getAccountInfo":
        return { context, value: this.#accountInfo(address(params[0] as string)) };
      case "simulateTransaction":
        return {
          context,
          value: {
            err: await this.#simulate(this.#decode(params[0] as string)),
            logs: [],
            accounts: null,
            unitsConsumed: 6_000,
            returnData: null,
          },
        };
      case "sendTransaction": {
        const options = params[1] as { skipPreflight?: boolean } | undefined;
        return this.#send(this.#decode(params[0] as string), {
          preflight: options?.skipPreflight === false,
        });
      }
      case "getSignatureStatuses":
        return { context, value: (params[0] as string[]).map((s) => this.#status(s)) };
      default:
        throw new Error(`FakeSolanaChain: the method ${method} is not faked`);
    }
  }

  #accountInfo(account: Address) {
    const encode = (data: ReadonlyUint8Array) => ({
      data: [getBase64Decoder().decode(data), "base64"],
      executable: false,
      lamports: 2_039_280,
      owner: TOKEN_PROGRAM_ADDRESS,
      rentEpoch: 0,
      space: data.length,
    });
    if (account === this.usdc) {
      return encode(
        getMintEncoder().encode({
          mintAuthority: none(),
          supply: 1_000_000_000_000n,
          decimals: 6,
          isInitialized: true,
          freezeAuthority: none(),
        }),
      );
    }
    const owner = this.#tokenAccounts.get(account);
    if (!owner) return null;
    return encode(
      getTokenEncoder().encode({
        mint: this.usdc,
        owner,
        amount: 0n,
        delegate: none(),
        state: 1,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
      }),
    );
  }

  #decode(wire: string): Decoded {
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const instructions = getInstructionsFromCompiledTransactionMessage(compiled);
    const feePayer = compiled.staticAccounts[0];
    if (!feePayer) throw new Error("FakeSolanaChain: no fee payer");
    return { transaction, feePayer, instructions };
  }

  // What the token program would answer: a transfer into a token account
  // that doesn't exist, or wasn't created earlier in the transaction,
  // fails. Buyers' source accounts always exist.
  async #simulate({ instructions }: Decoded): Promise<unknown> {
    const created = new Set<Address>();
    for (const [index, instruction] of instructions.entries()) {
      if (isTokenAccountCreation(instruction)) {
        created.add(
          parseCreateAssociatedTokenIdempotentInstruction(instruction as never).accounts.ata
            .address,
        );
      }
      if (instruction.programAddress !== TOKEN_PROGRAM_ADDRESS) continue;
      const transfer = parseTransferCheckedInstruction(instruction as never);
      const destination = transfer.accounts.destination.address;
      if (!this.#tokenAccounts.has(destination) && !created.has(destination)) {
        return { InstructionError: [index, "InvalidAccountData"] };
      }
    }
    return null;
  }

  async #send(decoded: Decoded, { preflight }: { preflight: boolean }): Promise<string> {
    const { transaction, feePayer, instructions } = decoded;
    await assertFullySigned(transaction);
    const signature = getBase58Decoder().decode(
      transaction.signatures[feePayer] ?? new Uint8Array(),
    );
    // A cluster processes each signature once. Sending it again (with
    // skipPreflight, as the stock mechanism does) answers the same signature.
    if (this.#landed.has(signature)) return signature;

    const err = await this.#simulate(decoded);
    // With preflight, the node refuses a transaction whose simulation fails,
    // and it never lands.
    if (err && preflight) throw new PreflightFailure(err);
    this.#landed.set(signature, { at: Date.now(), err });
    if (err) return signature;
    for (const instruction of instructions) {
      if (instruction.programAddress === TOKEN_PROGRAM_ADDRESS) {
        const transfer = parseTransferCheckedInstruction(instruction as never);
        this.transfers.push({
          signature,
          feePayer,
          authority: transfer.accounts.authority.address,
          destination: transfer.accounts.destination.address,
          amount: transfer.data.amount,
        });
      } else if (isTokenAccountCreation(instruction)) {
        const create = parseCreateAssociatedTokenIdempotentInstruction(instruction as never);
        const tokenAccount = create.accounts.ata.address;
        if (create.accounts.mint.address !== this.usdc) {
          throw new Error("FakeSolanaChain: only USDC token accounts are expected");
        }
        if (!this.#tokenAccounts.has(tokenAccount)) {
          this.#tokenAccounts.set(tokenAccount, create.accounts.owner.address);
          this.tokenAccountCreations.push({
            signature,
            feePayer,
            owner: create.accounts.owner.address,
            tokenAccount,
          });
        }
      } else if (instruction.programAddress !== MEMO_PROGRAM && !isComputeBudget(instruction)) {
        throw new Error(`FakeSolanaChain: unexpected program ${instruction.programAddress}`);
      }
    }
    return signature;
  }

  #status(signature: string) {
    const landed = this.#landed.get(signature);
    if (!landed || Date.now() - landed.at < (this.faults.confirmationDelayMs ?? 0)) return null;
    return {
      slot: SLOT,
      confirmations: null,
      err: landed.err,
      status: landed.err ? { Err: landed.err } : { Ok: null },
      confirmationStatus: "confirmed",
    };
  }
}

type Decoded = {
  transaction: Transaction;
  feePayer: Address;
  instructions: ReturnType<typeof getInstructionsFromCompiledTransactionMessage>;
};

const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

/** A transaction a node refused because its preflight simulation failed with `err`. */
class PreflightFailure extends Error {
  readonly err: unknown;

  constructor(err: unknown) {
    super("Transaction simulation failed");
    this.err = err;
  }
}

function isTokenAccountCreation(instruction: Decoded["instructions"][number]): boolean {
  return (
    instruction.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS &&
    identifyAssociatedTokenInstruction(instruction as never) ===
      AssociatedTokenInstruction.CreateAssociatedTokenIdempotent
  );
}

function isComputeBudget(instruction: { programAddress: Address }) {
  return instruction.programAddress === COMPUTE_BUDGET_PROGRAM;
}

// A cluster rejects a transaction unless every required signer signed it.
async function assertFullySigned(transaction: Transaction) {
  for (const [signer, signature] of Object.entries(transaction.signatures)) {
    if (!signature) throw new Error(`FakeSolanaChain: ${signer} didn't sign`);
    const key = await crypto.subtle.importKey(
      "raw",
      getAddressEncoder().encode(address(signer)) as Uint8Array<ArrayBuffer>,
      "Ed25519",
      true,
      ["verify"],
    );
    if (!(await verifySignature(key, signature, transaction.messageBytes))) {
      throw new Error(`FakeSolanaChain: bad signature from ${signer}`);
    }
  }
}
