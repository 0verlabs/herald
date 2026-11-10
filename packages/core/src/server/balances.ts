import { providers } from "@herald/db/schema";
import { eq } from "drizzle-orm";
import { networkRegistry, type Caip2, type Network } from "../networks.ts";
import { postRpc } from "../rpc.ts";
import { ProviderSchema, type HeraldEnv } from "../schemas.ts";
import type { Db } from "./db.ts";

/**
 * Reads how much USDC `owner` holds on `network`, in base units as a decimal
 * string, from that chain's RPC. An address that never received USDC holds
 * "0". Rejects if the chain can't be read.
 */
export type UsdcBalanceReader = (request: { network: Network; owner: string }) => Promise<string>;

/**
 * A Receiving Address's USDC balance on one chain, or why it couldn't be
 * read. `message` is safe to show the Provider.
 */
export type ChainBalance = { network: Caip2; label: string; address: string } & (
  | { ok: true; amount: string }
  | { ok: false; message: string }
);

/** How long one chain's balance read may take before it counts as failed. */
export const BALANCE_READ_TIMEOUT_MS = 8_000;

/**
 * The live USDC balance of a Provider's Receiving Address on every network
 * of `env`, in Payment Option order, all read at once. A chain that can't be
 * read, or takes longer than `timeoutMs` (default
 * `BALANCE_READ_TIMEOUT_MS`), comes back as `ok: false` without holding up
 * the others, and the failure is logged. The message doesn't repeat the
 * reader's error, which could name a private RPC endpoint. Null if no
 * Provider has this id.
 */
export async function getProviderBalances(
  deps: { db: Db; readUsdcBalance: UsdcBalanceReader; timeoutMs?: number },
  input: { providerId: number; env: HeraldEnv },
): Promise<ChainBalance[] | null> {
  const [row] = await deps.db.select().from(providers).where(eq(providers.id, input.providerId));
  if (!row) return null;
  const provider = ProviderSchema.parse(row);
  const timeoutMs = deps.timeoutMs ?? BALANCE_READ_TIMEOUT_MS;
  return Promise.all(
    networkRegistry[input.env].map(async (network): Promise<ChainBalance> => {
      const address = network.kind === "evm" ? provider.evmAddress : provider.solanaAddress;
      const chain = { network: network.caip2, label: network.label, address };
      try {
        const amount = await withTimeout(
          deps.readUsdcBalance({ network, owner: address }),
          timeoutMs,
          `No answer from ${network.label} within ${timeoutMs} ms`,
        );
        return { ...chain, ok: true, amount };
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "usdc_balance_read_failed",
            providerId: provider.id,
            network: network.caip2,
            error: String(error),
          }),
        );
        return {
          ...chain,
          ok: false,
          message: `Herald couldn't read the balance from ${network.label}. Try again later.`,
        };
      }
    }),
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ERC-20 `balanceOf(address)`.
const BALANCE_OF_SELECTOR = "0x70a08231";

/**
 * A `UsdcBalanceReader` over each chain's JSON-RPC endpoint, from `rpcUrls`
 * keyed by CAIP-2 network. EVM chains answer `balanceOf` on the USDC
 * contract at the latest block; Solana sums the owner's USDC token accounts
 * at `confirmed` commitment. A network without an endpoint fails to read.
 * Errors never include the endpoint, whose URL may carry an API key.
 */
export function rpcUsdcBalanceReader(
  rpcUrls: Partial<Record<Caip2, string>>,
  fetchFn: typeof fetch = fetch,
): UsdcBalanceReader {
  return async ({ network, owner }) => {
    const url = rpcUrls[network.caip2];
    if (!url) throw new Error(`Herald has no RPC endpoint for ${network.label}`);
    const call = (method: string, params: unknown[]) =>
      jsonRpc(fetchFn, url, network.label, method, params);

    if (network.kind === "evm") {
      const data = BALANCE_OF_SELECTOR + owner.slice(2).toLowerCase().padStart(64, "0");
      const result = await call("eth_call", [{ to: network.usdc.address, data }, "latest"]);
      if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) {
        throw new Error(`${network.label} answered balanceOf with ${JSON.stringify(result)}`);
      }
      return BigInt(result).toString();
    }

    const result = (await call("getTokenAccountsByOwner", [
      owner,
      { mint: network.usdc.address },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ])) as { value?: { account?: { data?: { parsed?: { info?: TokenInfo } } } }[] } | null;
    if (!Array.isArray(result?.value)) {
      throw new Error(`${network.label} answered getTokenAccountsByOwner without accounts`);
    }
    let total = 0n;
    for (const { account } of result.value) {
      const amount = account?.data?.parsed?.info?.tokenAmount?.amount;
      if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
        throw new Error(`${network.label} answered a token account without an amount`);
      }
      total += BigInt(amount);
    }
    return total.toString();
  };
}

type TokenInfo = { tokenAmount?: { amount?: unknown } };

async function jsonRpc(
  fetchFn: typeof fetch,
  url: string,
  label: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await postRpc(
    fetchFn,
    url,
    { jsonrpc: "2.0", id: 1, method, params },
    `${label} RPC ${method}`,
    // `getProviderBalances` stops waiting at its own timeout; this also
    // cancels the request itself.
    AbortSignal.timeout(BALANCE_READ_TIMEOUT_MS),
  );
  const body = (await response.json()) as { result?: unknown; error?: { message?: unknown } };
  if (body.error !== undefined) {
    const reason =
      typeof body.error?.message === "string" ? body.error.message : JSON.stringify(body.error);
    throw new Error(`${label} RPC refused ${method}: ${reason}`);
  }
  return body.result;
}
