import { providers } from "@herald/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  Caip2Schema,
  findNetwork,
  networkRegistry,
  unhandledKind,
  type Caip2,
  type Network,
} from "../networks.ts";
import { decimalToBaseUnits } from "../price.ts";
import { callJsonRpc, rpcUrlSecret } from "../rpc.ts";
import type { HeraldEnv, Provider } from "../schemas.ts";
import type { Db } from "./db.ts";
import { callViewFunction, nearRpcAt, viewAccount } from "./near-protocol.ts";
import { providerFromRow } from "./providers.ts";

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
  const provider = await providerFromRow(deps.db, row, input.env);
  const timeoutMs = deps.timeoutMs ?? BALANCE_READ_TIMEOUT_MS;
  return Promise.all(
    networkRegistry[input.env].map(async (network): Promise<ChainBalance> => {
      const address = receivingAddressOn(provider, network);
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

function receivingAddressOn(provider: Provider, network: Network): string {
  switch (network.kind) {
    case "evm":
      return provider.evmAddress;
    case "solana":
      return provider.solanaAddress;
    case "near":
      return provider.nearAddress;
    default:
      return unhandledKind(network);
  }
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
 * at `confirmed` commitment; NEAR answers `ft_balance_of` on the USDC
 * contract at final finality. A network without an endpoint fails to read.
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

    switch (network.kind) {
      case "evm": {
        const data = BALANCE_OF_SELECTOR + owner.slice(2).toLowerCase().padStart(64, "0");
        const result = await call("eth_call", [{ to: network.usdc.address, data }, "latest"]);
        if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) {
          throw new Error(`${network.label} answered balanceOf with ${JSON.stringify(result)}`);
        }
        return BigInt(result).toString();
      }
      case "solana": {
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
      }
      case "near": {
        const amount = await callViewFunction(
          nearRpcAt(fetchFn, url, `${network.label} RPC`, BALANCE_READ_TIMEOUT_MS),
          network.usdc.address,
          "ft_balance_of",
          { account_id: owner },
        );
        if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
          throw new Error(`${network.label} answered ft_balance_of without an amount`);
        }
        return amount;
      }
      default:
        return unhandledKind(network);
    }
  };
}

type TokenInfo = { tokenAmount?: { amount?: unknown } };

function jsonRpc(
  fetchFn: typeof fetch,
  url: string,
  label: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  // `getProviderBalances` stops waiting at its own timeout; this also
  // cancels the request itself.
  return callJsonRpc(fetchFn, url, label, method, params, BALANCE_READ_TIMEOUT_MS);
}

/**
 * The address of Herald's gas wallet on `network`, from the chain queue that
 * holds its key: one EVM wallet shared by every EVM network, the Solana
 * fee payer, and the NEAR relayer. Rejects if the queue can't name it, as
 * the NEAR queue can't without its relayer key.
 */
export type GasWalletAddressReader = (network: Network) => Promise<string>;

/**
 * Reads how much of `network`'s native token (`network.native`) `owner`
 * holds, in base units as a decimal string: wei, lamports, yoctoNEAR.
 * Rejects if the chain can't be read.
 */
export type NativeBalanceReader = (request: { network: Network; owner: string }) => Promise<string>;

/**
 * Below which native balance each network's gas wallet counts as low, keyed
 * by CAIP-2 network, in whole tokens (`{ "eip155:8453": "0.005" }`). It is
 * configuration, so a JSON string of the same object reads too. A network
 * without one is never low. A key must be a network Herald knows: one it
 * lists, or one it has an RPC endpoint for ahead of listing it (NEAR
 * mainnet), so the threshold is in place the day it is listed. Anything else,
 * such as a typo, is refused, since it would never warn.
 */
const LowBalanceThresholdsSchema = z.preprocess(
  (raw) => (typeof raw === "string" ? JSON.parse(raw) : raw),
  z.record(
    z.string().refine((key) => findNetwork(key) !== undefined || isCaip2WithRpc(key)),
    z.string().regex(/^\d+(\.\d+)?$/, "must be an amount like 0.005"),
  ),
);

function isCaip2WithRpc(key: string): boolean {
  const caip2 = Caip2Schema.safeParse(key);
  return caip2.success && rpcUrlSecret(caip2.data) !== undefined;
}

/**
 * Herald's gas wallet on one network, its native balance, and whether that
 * is below the network's low-balance `threshold` (null without one).
 * Amounts are base units of the native token, `symbol` with `decimals`.
 * When the wallet can't be read, `message` says so and is safe to show;
 * `address` is null if the chain queue couldn't name it either.
 */
export type GasWalletStatus = {
  network: Caip2;
  label: string;
  symbol: string;
  decimals: number;
  threshold: string | null;
} & (
  | { ok: true; address: string; balance: string; low: boolean }
  | { ok: false; address: string | null; message: string }
);

/**
 * Herald's gas wallet on every network of `env`, in Payment Option order,
 * with its live native balance and a low-balance warning against
 * `lowBalanceThresholds` (see `LowBalanceThresholdsSchema`). All networks are
 * read at once; one that can't be read, or takes longer than `timeoutMs`
 * (default `BALANCE_READ_TIMEOUT_MS`), comes back as `ok: false` without
 * holding up the others, and the failure is logged. Throws if the
 * thresholds don't parse, or one has more decimal places than its token.
 */
export async function getGasWallets(
  deps: {
    gasWalletAddress: GasWalletAddressReader;
    readNativeBalance: NativeBalanceReader;
    timeoutMs?: number;
  },
  input: { env: HeraldEnv; lowBalanceThresholds: unknown },
): Promise<GasWalletStatus[]> {
  const parsed = LowBalanceThresholdsSchema.safeParse(input.lowBalanceThresholds);
  if (!parsed.success) {
    const problem = parsed.error.issues
      .map((issue) => [...issue.path, issue.message].join(": "))
      .join("; ");
    console.error(JSON.stringify({ event: "gas_low_balance_thresholds_invalid", problem }));
    throw new Error(`The low-balance thresholds are invalid: ${problem}`);
  }
  const thresholds = parsed.data;
  const timeoutMs = deps.timeoutMs ?? BALANCE_READ_TIMEOUT_MS;
  const networks = networkRegistry[input.env].map((network) => {
    const threshold = thresholds[network.caip2];
    return {
      network,
      threshold:
        threshold === undefined ? null : decimalToBaseUnits(threshold, network.native.decimals),
    };
  });
  return Promise.all(
    networks.map(async ({ network, threshold }): Promise<GasWalletStatus> => {
      const wallet = {
        network: network.caip2,
        label: network.label,
        symbol: network.native.symbol,
        decimals: network.native.decimals,
        threshold,
      };
      let address: string | null = null;
      try {
        address = await withTimeout(
          deps.gasWalletAddress(network),
          timeoutMs,
          `No gas wallet address for ${network.label} within ${timeoutMs} ms`,
        );
        const balance = await withTimeout(
          deps.readNativeBalance({ network, owner: address }),
          timeoutMs,
          `No answer from ${network.label} within ${timeoutMs} ms`,
        );
        const low = threshold !== null && BigInt(balance) < BigInt(threshold);
        return { ...wallet, ok: true, address, balance, low };
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "gas_wallet_read_failed",
            network: network.caip2,
            error: String(error),
          }),
        );
        return {
          ...wallet,
          ok: false,
          address,
          message:
            address === null
              ? `Herald couldn't get its ${network.label} gas wallet from the chain queue.`
              : `Herald couldn't read the gas wallet's balance from ${network.label}.`,
        };
      }
    }),
  );
}

/**
 * A `NativeBalanceReader` over each chain's JSON-RPC endpoint, from
 * `rpcUrls` keyed by CAIP-2 network: `eth_getBalance` at the latest block
 * on EVM chains, `getBalance` at `confirmed` commitment on Solana, and
 * `view_account` at final finality on NEAR (0 for an account that doesn't
 * exist). A network without an endpoint fails to read. Errors never include
 * the endpoint.
 */
export function rpcNativeBalanceReader(
  rpcUrls: Partial<Record<Caip2, string>>,
  fetchFn: typeof fetch = fetch,
): NativeBalanceReader {
  return async ({ network, owner }) => {
    const url = rpcUrls[network.caip2];
    if (!url) throw new Error(`Herald has no RPC endpoint for ${network.label}`);

    switch (network.kind) {
      case "evm": {
        const result = await jsonRpc(fetchFn, url, network.label, "eth_getBalance", [
          owner,
          "latest",
        ]);
        if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) {
          throw new Error(
            `${network.label} answered eth_getBalance with ${JSON.stringify(result)}`,
          );
        }
        return BigInt(result).toString();
      }
      case "solana": {
        const result = (await jsonRpc(fetchFn, url, network.label, "getBalance", [
          owner,
          { commitment: "confirmed" },
        ])) as { value?: unknown } | null;
        const lamports = result?.value;
        if (typeof lamports !== "number" || !Number.isSafeInteger(lamports) || lamports < 0) {
          throw new Error(`${network.label} answered getBalance without a balance`);
        }
        return BigInt(lamports).toString();
      }
      case "near": {
        // `amount` is the liquid balance (staked NEAR is `locked`). It
        // includes the few thousandths of a NEAR the account's own storage
        // holds back, which doesn't matter against a 0.5 NEAR threshold.
        const account = await viewAccount(
          nearRpcAt(fetchFn, url, `${network.label} RPC`, BALANCE_READ_TIMEOUT_MS),
          owner,
        );
        // A relayer that was never created holds nothing, and warns low.
        const amount = account === null ? "0" : account.amount;
        if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
          throw new Error(`${network.label} answered view_account without a balance`);
        }
        return amount;
      }
      default:
        return unhandledKind(network);
    }
  };
}
