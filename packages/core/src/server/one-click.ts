import { z } from "zod";
import type { Caip2 } from "../networks.ts";
import { fetchPrivateEndpoint } from "../rpc.ts";

// 1Click (NEAR Intents' swap API) carries a cross-chain or Intents Sweep:
// Herald asks it for a quote, the Sweep's transfer goes to the quote's
// deposit address, and 1Click delivers USDC to the destination chain or
// credits the Provider's NEAR Intents account. 1Click runs on mainnet only.
// API: https://1click.chaindefuser.com/docs/v0/openapi.yaml (v0.1.10).

export const ONE_CLICK_URL = "https://1click.chaindefuser.com";

/**
 * The 1Click asset id of USDC on each mainnet network Herald lists, from
 * `GET /v0/tokens` on 2026-11-11 (NEAR's on 2026-11-13). Sweeping into NEAR
 * Intents credits the same asset, so it is also the Intents token id. On
 * NEAR it is Circle's NEP-141 contract itself.
 */
export const oneClickUsdcAssets: Partial<Record<Caip2, string>> = {
  "near:mainnet": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "eip155:8453": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp":
    "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  "eip155:42161": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  "eip155:137": "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near",
  "eip155:43114": "nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near",
};

/** 1Click's id of USDC on `network`, or undefined if 1Click can't Sweep from or to it. */
export function oneClickUsdcAsset(network: Caip2): string | undefined {
  return oneClickUsdcAssets[network];
}

/**
 * Where 1Click sends a Sweep: USDC to an address on another chain
 * (`DESTINATION_CHAIN`), or a credit to an account inside NEAR Intents
 * (`INTENTS`).
 */
export type OneClickRecipientType = "DESTINATION_CHAIN" | "INTENTS";

/**
 * What Herald asks 1Click to quote. Herald always quotes an exact input
 * (`EXACT_INPUT`) deposited on the origin chain, with refunds to `refundTo`
 * on the origin chain, the source Receiving Address. `deadline` is when
 * 1Click starts refunding if the swap hasn't completed.
 */
export type OneClickQuoteRequest = {
  originAsset: string;
  destinationAsset: string;
  /** Base units of `originAsset`. */
  amount: string;
  refundTo: string;
  recipient: string;
  recipientType: OneClickRecipientType;
  /** Basis points. */
  slippageTolerance: number;
  deadline: Date;
};

/**
 * A live 1Click quote: send `amountIn` of the origin asset to
 * `depositAddress` before `deadline` and 1Click delivers about `amountOut`
 * (at least `minAmountOut`) of the destination asset, `timeEstimate`
 * seconds after the deposit confirms. If it refunds, it keeps `refundFee`
 * of the origin asset. `signature` is 1Click's signature of the quote, kept
 * for disputes. `quoteId` is 1Click's correlation id.
 */
export type OneClickQuote = {
  quoteId: string;
  depositAddress: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  refundFee: string;
  timeEstimate: number;
  deadline: Date;
  /** When the deposit address goes cold and processing slows, if 1Click says. */
  timeWhenInactive: Date | null;
  signature: string;
};

/**
 * 1Click's answer to a quote request: a quote, an amount below its minimum
 * for the route (`minimum` in base units, when it says), or another refusal
 * with its message.
 */
export type OneClickQuoteResult =
  | { ok: true; quote: OneClickQuote }
  | { ok: false; reason: "below_minimum"; minimum: string | null; message: string }
  | { ok: false; reason: "refused"; message: string };

/**
 * Where a 1Click swap stands (`GET /v0/status`):
 *
 * - `PENDING_DEPOSIT`: 1Click hasn't seen the deposit yet.
 * - `KNOWN_DEPOSIT_TX`, `PROCESSING`: it has, and is delivering.
 * - `INCOMPLETE_DEPOSIT`: the deposit was below the quote; 1Click refunds it.
 * - `SUCCESS`: delivered. `REFUNDED`: refunded to `refundTo`. `FAILED`: it gave up.
 */
export const OneClickSwapStatusSchema = z.enum([
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "PROCESSING",
  "INCOMPLETE_DEPOSIT",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
]);
export type OneClickSwapStatus = z.infer<typeof OneClickSwapStatusSchema>;

/**
 * A 1Click swap's status with what Herald records: the amount delivered,
 * the amount refunded and why, and the delivery's transaction hashes on
 * the destination chain.
 */
export type OneClickSwap = {
  status: OneClickSwapStatus;
  amountOut: string | null;
  refundedAmount: string | null;
  refundReason: string | null;
  destinationTxHashes: string[];
};

/**
 * 1Click, as Herald uses it. `quote` asks for a live quote (with a deposit
 * address); `status` reads a swap by its deposit address, null if 1Click
 * doesn't know it. Both reject if 1Click can't be reached or answers
 * something unexpected.
 */
export interface OneClickClient {
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResult>;
  status(depositAddress: string): Promise<OneClickSwap | null>;
}

const QUOTE_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 8_000;

const QuoteResponseSchema = z.object({
  correlationId: z.string().min(1),
  signature: z.string().min(1),
  quote: z.object({
    depositAddress: z.string().min(1),
    // Herald quotes SIMPLE deposits; a memo would have to go with the transfer.
    depositMemo: z.never().optional(),
    amountIn: z.string().regex(/^\d+$/),
    amountOut: z.string().regex(/^\d+$/),
    minAmountOut: z.string().regex(/^\d+$/),
    refundFee: z.string().regex(/^\d+$/).optional(),
    timeEstimate: z.number().nonnegative(),
    deadline: z.iso.datetime({ offset: true }),
    timeWhenInactive: z.iso.datetime({ offset: true }).optional(),
  }),
});

const StatusResponseSchema = z.object({
  status: OneClickSwapStatusSchema,
  swapDetails: z
    .object({
      amountOut: z.string().regex(/^\d+$/).optional(),
      refundedAmount: z.string().regex(/^\d+$/).optional(),
      refundReason: z.string().optional(),
      destinationChainTxHashes: z.array(z.object({ hash: z.string().min(1) })).optional(),
    })
    .optional(),
});

/**
 * A `OneClickClient` over 1Click's HTTP API at `baseUrl`. `apiKey` is the
 * optional partner JWT, sent as `X-API-Key`: without it, 1Click still
 * quotes, with a higher fee on some routes. Errors never include the key.
 */
export function httpOneClickClient(
  options: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {},
): OneClickClient {
  const baseUrl = options.baseUrl ?? ONE_CLICK_URL;
  const fetchFn = options.fetch ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.apiKey) headers["x-api-key"] = options.apiKey;

  return {
    async quote(request) {
      const response = await fetchPrivateEndpoint(
        fetchFn,
        `${baseUrl}/v0/quote`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            dry: false,
            swapType: "EXACT_INPUT",
            depositType: "ORIGIN_CHAIN",
            depositMode: "SIMPLE",
            refundType: "ORIGIN_CHAIN",
            originAsset: request.originAsset,
            destinationAsset: request.destinationAsset,
            amount: request.amount,
            refundTo: request.refundTo,
            recipient: request.recipient,
            recipientType: request.recipientType,
            slippageTolerance: request.slippageTolerance,
            deadline: request.deadline.toISOString(),
          }),
          signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
        },
        "1Click quote",
      );
      const body: unknown = await response.json().catch(() => undefined);
      if (response.status === 400) return quoteRefusal(body);
      if (!response.ok) throw new Error(`1Click quote answered ${response.status}`);
      const parsed = QuoteResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(`1Click quote answered an unexpected body: ${parsed.error.message}`);
      }
      const { correlationId, signature, quote } = parsed.data;
      return {
        ok: true,
        quote: {
          quoteId: correlationId,
          signature,
          depositAddress: quote.depositAddress,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          minAmountOut: quote.minAmountOut,
          refundFee: quote.refundFee ?? "0",
          timeEstimate: quote.timeEstimate,
          deadline: new Date(quote.deadline),
          timeWhenInactive: quote.timeWhenInactive ? new Date(quote.timeWhenInactive) : null,
        },
      };
    },

    async status(depositAddress) {
      const response = await fetchPrivateEndpoint(
        fetchFn,
        `${baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
        { headers, signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
        "1Click status",
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`1Click status answered ${response.status}`);
      const parsed = StatusResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(`1Click status answered an unexpected body: ${parsed.error.message}`);
      }
      const { status, swapDetails } = parsed.data;
      return {
        status,
        amountOut: swapDetails?.amountOut ?? null,
        refundedAmount: swapDetails?.refundedAmount ?? null,
        refundReason: swapDetails?.refundReason ?? null,
        destinationTxHashes: (swapDetails?.destinationChainTxHashes ?? []).map((tx) => tx.hash),
      };
    },
  };
}

// Read from a live dry quote of 0.1 USDC from Base on 2026-11-11:
// `{"message":"Amount is too low for bridge, try at least 150000"}`.
const AT_LEAST = /try at least (\d+)/;

/** 1Click's 400 answer to a quote request, as a refusal. */
function quoteRefusal(body: unknown): OneClickQuoteResult {
  const message =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : "1Click refused the quote.";
  if (/too low/i.test(message)) {
    return {
      ok: false,
      reason: "below_minimum",
      minimum: AT_LEAST.exec(message)?.[1] ?? null,
      message,
    };
  }
  return { ok: false, reason: "refused", message };
}
