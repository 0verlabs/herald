import type { Caip2 } from "@herald/core";
import { eip3009ABI } from "@x402/evm";
import { DurableObject } from "cloudflare:workers";
import { concat, createWalletClient, decodeFunctionData, http, type Address, type Hex } from "viem";
import { evmChain, evmGasAccount, evmPublicClient, rpcUrl } from "./chains.ts";

const STORED_NONCE_TTL_MS = 60_000;

export type TransferWithAuthorizationSubmission = {
  network: Caip2;
  /** The EIP-3009 token contract (USDC). */
  asset: Address;
  /** ABI-encoded `transferWithAuthorization(...)` calldata. */
  data: Hex;
  dataSuffix?: Hex;
};

/**
 * The chain queue for one EVM network, addressed by its CAIP-2 id
 * (`EVM_CHAIN_QUEUE.getByName("eip155:84532")`). It owns that network's use
 * of the EVM gas wallet: every transaction is signed and broadcast here, one
 * at a time, with the nonce tracked in storage, so two Worker isolates never
 * race on a nonce. It also remembers each EIP-3009 authorization it has
 * submitted and refuses to submit one twice.
 *
 * It submits only `transferWithAuthorization` calls, so the gas wallet can't
 * be used for anything else. Settlements use it now; Sweeps will too.
 */
export class EvmChainQueue extends DurableObject<CloudflareBindings> {
  // Tail of the submission queue. Each submission starts after the previous
  // one has been broadcast or has failed.
  #tail: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS submitted_authorizations (
        authorization_key TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        submitted_at INTEGER NOT NULL
      )`,
    );
  }

  /** Signs and broadcasts a `transferWithAuthorization`; returns the tx hash. */
  submitTransferWithAuthorization(submission: TransferWithAuthorizationSubmission): Promise<Hex> {
    const run = this.#tail.then(() => this.#submit(submission));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #submit({ network, asset, data, dataSuffix }: TransferWithAuthorizationSubmission) {
    const call = decodeFunctionData({ abi: eip3009ABI, data });
    if (call.functionName !== "transferWithAuthorization") {
      throw new Error(
        `The chain queue only submits transferWithAuthorization, not ${call.functionName}`,
      );
    }
    const [from, , , , , authorizationNonce] = call.args;
    // EIP-3009 nonces are scoped to the authorizer and the token contract.
    const authorizationKey = `${asset.toLowerCase()}:${from.toLowerCase()}:${authorizationNonce.toLowerCase()}`;
    const [previous] = this.ctx.storage.sql
      .exec<{ tx_hash: string }>(
        "SELECT tx_hash FROM submitted_authorizations WHERE authorization_key = ?",
        authorizationKey,
      )
      .toArray();
    if (previous) {
      // Worded so the stock mechanism reports `invalid_exact_evm_nonce_already_used`.
      throw new Error(
        `EIP-3009 authorization is used: Herald already submitted it in ${previous.tx_hash}`,
      );
    }

    const account = evmGasAccount(this.env);
    const chain = evmChain(network);
    const wallet = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl(this.env, network)),
    });

    // The chain's pending count is the source of truth. The nonce stored
    // after the last broadcast covers the moment a load-balanced RPC hasn't
    // seen that transaction yet. It expires after a minute, so a transaction
    // the mempool dropped can't leave a nonce gap that blocks every later one.
    const pending = await evmPublicClient(this.env, network).getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const last = this.ctx.storage.kv.get<{ next: number; at: number }>("nonce");
    const recent = last !== undefined && Date.now() - last.at < STORED_NONCE_TTL_MS;
    const nonce = recent ? Math.max(pending, last.next) : pending;

    let hash: Hex;
    try {
      hash = await wallet.sendTransaction({
        to: asset,
        data: dataSuffix ? concat([data, dataSuffix]) : data,
        nonce,
      });
    } catch (error) {
      // Resynchronise from the chain on the next submission.
      this.ctx.storage.kv.delete("nonce");
      throw error;
    }
    this.ctx.storage.kv.put("nonce", { next: nonce + 1, at: Date.now() });
    this.ctx.storage.sql.exec(
      "INSERT INTO submitted_authorizations (authorization_key, tx_hash, submitted_at) VALUES (?, ?, ?)",
      authorizationKey,
      hash,
      Date.now(),
    );
    return hash;
  }
}
