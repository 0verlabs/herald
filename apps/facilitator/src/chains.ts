import {
  fetchPrivateEndpoint,
  findNetwork,
  HeraldEnvSchema,
  requestFailedError,
  rpcUrlSecret,
  type Caip2,
  type HeraldEnv,
} from "@herald/core";
import { base58 } from "@scure/base";
import {
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  type Address,
  type RpcTransport,
  type Signature,
} from "@solana/kit";
import { TransactionOnchainFailureError } from "@x402/svm";
import {
  createPublicClient,
  http,
  type Chain,
  type Hex,
  type HttpTransport,
  type HttpTransportConfig,
  type PublicClient,
} from "viem";
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
 * The JSON-RPC endpoint for a network, from its `<CHAIN>_RPC_URL` secret
 * (see `rpcUrlSecret` in core). Every endpoint is a private one (its URL
 * carries the API key), and Solana's public endpoints refuse requests from
 * Workers anyway: they block on the `CF-Worker` header.
 *
 * Only `evmTransport` and `solanaRpc` should take the URL: they keep it out
 * of the errors the chain libraries throw.
 */
function rpcUrl(env: CloudflareBindings, network: Caip2): string {
  const secret = rpcUrlSecret(network);
  if (!secret) throw new Error(`Herald has no RPC endpoint secret for ${network}`);
  const url = env[secret];
  if (!url) throw new Error(`The ${secret} secret is not set`);
  return url;
}

/** How errors name a network's endpoint: `"Base Sepolia RPC"`. */
function rpcName(network: Caip2): string {
  return `${findNetwork(network)?.label ?? network} RPC`;
}

/**
 * A viem HTTP transport to a network's RPC endpoint. viem writes the
 * request URL into its error messages, and the stock x402 mechanisms pass
 * those on to the Provider's server as `errorMessage`, so viem never gets
 * the real URL: it gets a placeholder naming the network, and `fetchFn`
 * sends each request to the real endpoint through `fetchPrivateEndpoint`.
 */
export function evmTransport(
  env: CloudflareBindings,
  network: Caip2,
  options: Pick<HttpTransportConfig, "timeout" | "retryCount"> = {},
): HttpTransport {
  const url = rpcUrl(env, network);
  return http(`https://rpc.herald.invalid/${network}`, {
    ...options,
    fetchFn: (_placeholder, init) => fetchPrivateEndpoint(fetch, url, init ?? {}, rpcName(network)),
  });
}

export function evmPublicClient(env: CloudflareBindings, network: Caip2): PublicClient {
  return createPublicClient({
    chain: evmChain(network),
    transport: evmTransport(env, network),
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

/**
 * A Solana JSON-RPC client for a Solana network's endpoint (see `rpcUrl`).
 * `@solana/kit` offers no fetch hook, so its transport is wrapped instead.
 * Kit's own errors (an HTTP status, a JSON-RPC error) carry no URL and pass
 * through unchanged, since the chain queue reads their codes. Any other
 * failure, such as the runtime refusing the connection, whose message can
 * name the URL, becomes core's `requestFailedError`.
 */
export function solanaRpc(env: CloudflareBindings, network: Caip2) {
  const transport = createDefaultRpcTransport({ url: rpcUrl(env, network) });
  const withoutUrlInErrors: RpcTransport = async (config) => {
    try {
      return await transport(config);
    } catch (error) {
      if (isSolanaError(error)) throw error;
      throw requestFailedError(rpcName(network), error);
    }
  };
  return createSolanaRpcFromTransport(withoutUrlInErrors);
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
