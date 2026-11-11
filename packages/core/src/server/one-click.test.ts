import { describe, expect, test } from "vite-plus/test";
import { httpOneClickClient, type OneClickQuoteRequest } from "./one-click.ts";

// Bodies follow live 1Click answers read on 2026-11-11 (a dry quote of
// 1 USDC from Base to Arbitrum, and a quote below Base's minimum), with the
// fields a non-dry quote adds per the OpenAPI spec v0.1.10.

const request: OneClickQuoteRequest = {
  originAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  destinationAsset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  amount: "1000000",
  refundTo: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
  recipient: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
  recipientType: "DESTINATION_CHAIN",
  slippageTolerance: 50,
  deadline: new Date("2026-11-11T10:02:11.000Z"),
};

const quoteBody = {
  quote: {
    depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8",
    amountIn: "1000000",
    amountInFormatted: "1.0",
    amountInUsd: "0.999565000000",
    minAmountIn: "1000000",
    amountOut: "994498",
    amountOutFormatted: "0.994498",
    amountOutUsd: "0.994065393370",
    minAmountOut: "989525",
    deadline: "2026-11-11T10:02:11.000Z",
    timeWhenInactive: "2026-11-11T09:52:11.000Z",
    timeEstimate: 34,
    refundFee: "2400",
    withdrawFee: "5300",
  },
  quoteRequest: { dry: false },
  signature:
    "ed25519:5Rc8ZuixnHAFticTU5wfvKoTw5Dfpg7EPGwKhcJ61aPa7P2HNK8SW3h2bsSg91QE7NQmEJnJRUQxStGkUkEeTgyN",
  timestamp: "2026-11-11T09:32:11.388Z",
  correlationId: "5146a44f-4103-4d6e-88ac-ee1502ebf6fe",
};

/** A `fetch` that records each request and answers `status` with `body`. */
function fakeFetch(status: number, body: unknown) {
  const requests: Request[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { requests, fetchFn };
}

describe("httpOneClickClient", () => {
  test("asks for a live exact-input quote with refunds on the origin chain, and reads it", async () => {
    const { requests, fetchFn } = fakeFetch(201, quoteBody);

    const result = await httpOneClickClient({ fetch: fetchFn, apiKey: "jwt-123" }).quote(request);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://1click.chaindefuser.com/v0/quote");
    expect(requests[0]!.headers.get("x-api-key")).toBe("jwt-123");
    expect(await requests[0]!.json()).toEqual({
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "ORIGIN_CHAIN",
      depositMode: "SIMPLE",
      refundType: "ORIGIN_CHAIN",
      originAsset: request.originAsset,
      destinationAsset: request.destinationAsset,
      amount: "1000000",
      refundTo: request.refundTo,
      recipient: request.recipient,
      recipientType: "DESTINATION_CHAIN",
      slippageTolerance: 50,
      deadline: "2026-11-11T10:02:11.000Z",
    });
    expect(result).toEqual({
      ok: true,
      quote: {
        quoteId: "5146a44f-4103-4d6e-88ac-ee1502ebf6fe",
        signature: quoteBody.signature,
        depositAddress: "0x76b4c56085ED136a8744D52bE956396624a730E8",
        amountIn: "1000000",
        amountOut: "994498",
        minAmountOut: "989525",
        refundFee: "2400",
        timeEstimate: 34,
        deadline: new Date("2026-11-11T10:02:11.000Z"),
        timeWhenInactive: new Date("2026-11-11T09:52:11.000Z"),
      },
    });
  });

  test("sends no API key header without a JWT", async () => {
    const { requests, fetchFn } = fakeFetch(201, quoteBody);

    await httpOneClickClient({ fetch: fetchFn }).quote(request);

    expect(requests[0]!.headers.has("x-api-key")).toBe(false);
  });

  test("reads 1Click's minimum from its answer to an amount below it", async () => {
    const { fetchFn } = fakeFetch(400, {
      message: "Amount is too low for bridge, try at least 150000",
      correlationId: "fe7faa52-91b5-4db3-83c1-d6191649f624",
      timestamp: "2026-11-11T09:32:13.362Z",
      path: "/v0/quote",
    });

    const result = await httpOneClickClient({ fetch: fetchFn }).quote(request);

    expect(result).toEqual({
      ok: false,
      reason: "below_minimum",
      minimum: "150000",
      message: "Amount is too low for bridge, try at least 150000",
    });
  });

  test("passes on any other refusal", async () => {
    const { fetchFn } = fakeFetch(400, { message: "refundTo is not valid" });

    const result = await httpOneClickClient({ fetch: fetchFn }).quote(request);

    expect(result).toEqual({ ok: false, reason: "refused", message: "refundTo is not valid" });
  });

  test("rejects a quote without a deposit address, or one that needs a memo", async () => {
    const { depositAddress: _, ...dry } = quoteBody.quote;
    const withMemo = { ...quoteBody, quote: { ...quoteBody.quote, depositMemo: "1111111" } };

    for (const body of [{ ...quoteBody, quote: dry }, withMemo]) {
      const { fetchFn } = fakeFetch(201, body);
      await expect(httpOneClickClient({ fetch: fetchFn }).quote(request)).rejects.toThrow(
        "unexpected body",
      );
    }
  });

  test("rejects when 1Click fails", async () => {
    const { fetchFn } = fakeFetch(503, { message: "Service unavailable" });

    await expect(httpOneClickClient({ fetch: fetchFn }).quote(request)).rejects.toThrow("503");
  });

  test("reads a swap's status, its delivery and refund", async () => {
    const { requests, fetchFn } = fakeFetch(200, {
      correlationId: "c",
      quoteResponse: quoteBody,
      status: "SUCCESS",
      updatedAt: "2026-11-11T09:40:00.000Z",
      swapDetails: {
        intentHashes: [],
        nearTxHashes: [],
        amountOut: "994498",
        originChainTxHashes: [{ hash: "0xaa", explorerUrl: "https://basescan.org/tx/0xaa" }],
        destinationChainTxHashes: [{ hash: "0xbb", explorerUrl: "https://arbiscan.io/tx/0xbb" }],
      },
    });

    const swap = await httpOneClickClient({ fetch: fetchFn }).status(
      "0x76b4c56085ED136a8744D52bE956396624a730E8",
    );

    expect(requests[0]!.url).toBe(
      "https://1click.chaindefuser.com/v0/status?depositAddress=0x76b4c56085ED136a8744D52bE956396624a730E8",
    );
    expect(swap).toEqual({
      status: "SUCCESS",
      amountOut: "994498",
      refundedAmount: null,
      refundReason: null,
      destinationTxHashes: ["0xbb"],
    });
  });

  test("reads an unknown deposit address as null", async () => {
    const { fetchFn } = fakeFetch(404, {
      message: "Deposit address 0x0000000000000000000000000000000000000001 not found",
      statusCode: 404,
    });

    const swap = await httpOneClickClient({ fetch: fetchFn }).status(
      "0x0000000000000000000000000000000000000001",
    );

    expect(swap).toBeNull();
  });
});
