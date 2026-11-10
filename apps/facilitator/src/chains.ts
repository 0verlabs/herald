import { HeraldEnvSchema, type Caip2, type HeraldEnv } from "@herald/core";
import { base58 } from "@scure/base";
import { address, createSolanaRpc, type Address, type Signature } from "@solana/kit";
import { TransactionOnchainFailureError } from "@x402/svm";
import { createPublicClient, http, type Chain, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia, avalanche, base, baseSepolia, polygon } from "viem/chains";

/** viem's chain definition for each EVM network Herald lists. */
const evmChains: Partial<Record<Caip2, Chain>> = {
  "eip155:8453": base,
  "eip155:84532": baseSepolia,
  "eip155:42161": arbitrum,
  "eip155:421614": arbitrumSepolia,
  "eip155:137": polygon,
  "eip155:43114": avalanche,
};

export function heraldEnvOf(env: CloudflareBindings): HeraldEnv {
  return HeraldEnvSchema.parse(env.HERALD_ENV);
}

export function evmChain(network: Caip2): Chain {
  const chain = evmChains[network];
  if (!chain) throw new Error(`No EVM chain definition for ${network}`);
  return chain;
}

/**
 * The secret holding each network's JSON-RPC endpoint, named after the chain.
 * Each Herald environment sets it to that environment's network: on testnet
 * `BASE_RPC_URL` is Base Sepolia and `SOLANA_RPC_URL` Solana Devnet.
 */
const rpcUrlSecrets: Partial<Record<Caip2, RpcUrlSecret>> = {
  "eip155:8453": "BASE_RPC_URL",
  "eip155:84532": "BASE_RPC_URL",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "SOLANA_RPC_URL",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "SOLANA_RPC_URL",
  "eip155:42161": "ARBITRUM_RPC_URL",
  "eip155:421614": "ARBITRUM_RPC_URL",
  "eip155:137": "POLYGON_RPC_URL",
  "eip155:43114": "AVALANCHE_RPC_URL",
};

type RpcUrlSecret =
  | "BASE_RPC_URL"
  | "SOLANA_RPC_URL"
  | "ARBITRUM_RPC_URL"
  | "POLYGON_RPC_URL"
  | "AVALANCHE_RPC_URL";

/**
 * The JSON-RPC endpoint for a network, from its `<CHAIN>_RPC_URL` secret.
 * Every endpoint is a private one (its URL carries the API key), and
 * Solana's public endpoints refuse requests from Workers anyway: they block
 * on the `CF-Worker` header.
 */
export function rpcUrl(env: CloudflareBindings, network: Caip2): string {
  const secret = rpcUrlSecrets[network];
  if (!secret) throw new Error(`Herald has no RPC endpoint secret for ${network}`);
  const url = env[secret];
  if (!url) throw new Error(`The ${secret} secret is not set`);
  return url;
}

export function evmPublicClient(env: CloudflareBindings, network: Caip2): PublicClient {
  return createPublicClient({
    chain: evmChain(network),
    transport: http(rpcUrl(env, network)),
    pollingInterval: 1_000,
  });
}

/** Herald's EVM gas wallet, shared by every EVM network. */
export function evmGasAccount(env: CloudflareBindings): PrivateKeyAccount {
  const key = env.EVM_GAS_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("The EVM_GAS_KEY secret must be a 0x-prefixed 32-byte hex private key");
  }
  return privateKeyToAccount(key as Hex);
}

/**
 * Herald's Solana gas wallet, the fee payer of every Solana network.
 * `SOLANA_GAS_KEY` is a base58 64-byte secret key: the 32-byte seed, then the
 * public key, as `solana-keygen` writes it.
 */
export function solanaGasKey(env: CloudflareBindings): Uint8Array {
  let key: Uint8Array | undefined;
  try {
    key = env.SOLANA_GAS_KEY ? base58.decode(env.SOLANA_GAS_KEY) : undefined;
  } catch {
    key = undefined;
  }
  if (key?.length !== 64) {
    throw new Error("The SOLANA_GAS_KEY secret must be a base58 64-byte secret key");
  }
  return key;
}

/** The address of Herald's Solana fee payer: the public half of `SOLANA_GAS_KEY`. */
export function solanaFeePayerAddress(env: CloudflareBindings): Address {
  return address(base58.encode(solanaGasKey(env).subarray(32)));
}

/** A Solana JSON-RPC client for a Solana network's endpoint (see `rpcUrl`). */
export function solanaRpc(env: CloudflareBindings, network: Caip2) {
  return createSolanaRpc(rpcUrl(env, network));
}

const CONFIRMATION_POLL_MS = 500;
// One status lookup; a hung endpoint must not outlast the confirmation wait.
const STATUS_TIMEOUT_MS = 5_000;

/**
 * Waits up to `timeoutMs` for a Solana transaction to be confirmed. Throws
 * the stock `TransactionOnchainFailureError` if it landed and failed, and a
 * plain `Error` if it isn't confirmed in time (its outcome is then unknown).
 */
export async function confirmSolanaTransaction(
  rpc: ReturnType<typeof solanaRpc>,
  signature: string,
  options: { timeoutMs: number; searchTransactionHistory?: boolean },
): Promise<{ slot: bigint }> {
  const deadline = Date.now() + options.timeoutMs;
  let searchTransactionHistory = options.searchTransactionHistory === true;
  for (;;) {
    const {
      value: [status],
    } = await rpc
      .getSignatureStatuses([signature as Signature], { searchTransactionHistory })
      .send({ abortSignal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    searchTransactionHistory = false;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      if (status.err) {
        const reason = JSON.stringify(status.err, (_, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        );
        throw new TransactionOnchainFailureError(`Transaction failed onchain: ${reason}`);
      }
      return { slot: status.slot };
    }
    if (Date.now() >= deadline) {
      throw new Error(`Transaction ${signature} wasn't confirmed within ${options.timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_MS));
  }
}
