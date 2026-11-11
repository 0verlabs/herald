import type { Caip2 } from "./networks.ts";

// Herald's RPC endpoints are private URLs that carry an API key (QuickNode
// puts it in the path). The helpers here keep the URL out of every error
// they throw, so it can't reach a log line or a response.

/**
 * The secret (Worker binding) that holds each network's JSON-RPC endpoint,
 * named after the chain. Each Herald environment sets it to that
 * environment's network: on testnet `BASE_RPC_URL` is Base Sepolia and
 * `SOLANA_RPC_URL` Solana Devnet. Both Workers read the same secrets.
 */
const rpcUrlSecrets = {
  "eip155:8453": "BASE_RPC_URL",
  "eip155:84532": "BASE_RPC_URL",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "SOLANA_RPC_URL",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "SOLANA_RPC_URL",
  "eip155:42161": "ARBITRUM_RPC_URL",
  "eip155:421614": "ARBITRUM_RPC_URL",
  "eip155:137": "POLYGON_RPC_URL",
  "eip155:43114": "AVALANCHE_RPC_URL",
} as const satisfies Record<Caip2, string>;

export type RpcUrlSecret = (typeof rpcUrlSecrets)[keyof typeof rpcUrlSecrets];

/** The secret holding a network's JSON-RPC endpoint, or undefined for a network Herald doesn't list. */
export function rpcUrlSecret(network: Caip2): RpcUrlSecret | undefined {
  return (rpcUrlSecrets as Partial<Record<Caip2, RpcUrlSecret>>)[network];
}

/**
 * Every network's JSON-RPC endpoint, read from the `<CHAIN>_RPC_URL`
 * secrets in a Worker's `env`. Networks whose secret isn't set are left out.
 */
export function rpcUrlsFrom(
  env: Partial<Record<RpcUrlSecret, string>>,
): Partial<Record<Caip2, string>> {
  const urls: Partial<Record<Caip2, string>> = {};
  for (const [network, secret] of Object.entries(rpcUrlSecrets)) {
    const url = env[secret];
    if (url) urls[network as Caip2] = url;
  }
  return urls;
}

/**
 * The error to throw instead of a request to a private endpoint that failed
 * before an answer came back. It names `what` (e.g. `"Base Sepolia RPC"`)
 * and the error's kind only: a runtime's message can repeat the URL.
 */
export function requestFailedError(what: string, error: unknown): Error {
  const kind = error instanceof Error ? error.name : "Error";
  return new Error(`${what} request failed (${kind})`);
}

/**
 * `fetch` to a private endpoint. A failed request throws
 * `requestFailedError(what, …)` instead of the runtime's error.
 */
export async function fetchPrivateEndpoint(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  what: string,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    throw requestFailedError(what, error);
  }
}

/**
 * POSTs a JSON-RPC request to a private endpoint and returns the response if
 * its status is 2xx. Its errors name `what` (e.g.
 * `"NEAR RPC view_access_key"`) and the failure, never the URL.
 */
export async function postRpc(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  what: string,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetchPrivateEndpoint(
    fetchFn,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    what,
  );
  if (!response.ok) throw new Error(`${what} answered ${response.status}`);
  return response;
}

/**
 * Calls a JSON-RPC 2.0 method on a chain's private endpoint and returns its
 * `result`, giving up after `timeoutMs`. A failed request or an error answer
 * throws an error naming `label` (e.g. `"Base Sepolia"`) and the method,
 * never the URL.
 */
export async function callJsonRpc(
  fetchFn: typeof fetch,
  url: string,
  label: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const response = await postRpc(
    fetchFn,
    url,
    { jsonrpc: "2.0", id: 1, method, params },
    `${label} RPC ${method}`,
    AbortSignal.timeout(timeoutMs),
  );
  const body = (await response.json()) as { result?: unknown; error?: { message?: unknown } };
  if (body.error !== undefined) {
    const reason =
      typeof body.error?.message === "string" ? body.error.message : JSON.stringify(body.error);
    throw new Error(`${label} RPC refused ${method}: ${reason}`);
  }
  return body.result;
}
