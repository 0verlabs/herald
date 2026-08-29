import { describe, expect, test } from "bun:test";

import {
  erc8004FeedbackFileSchema,
  erc8004ReputationRegistryFeedbackRevokedEventSchema,
  erc8004ReputationRegistryNewFeedbackEventSchema,
  erc8004ReputationRegistryResponseAppendedEventSchema,
  normalizeErc8004FeedbackValue,
} from "./erc-8004";

const newFeedbackEvent = {
  id: "0xabc123-0",
  blockNumber: 42890000,
  transactionHash: "0xabc123",
  address: "0x8004baa17c55a88189ae136b182e5fda19de9b63",
  eventName: "ReputationRegistry:NewFeedback",
  args: {
    agentId: 22,
    clientAddress: "0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
    feedbackIndex: 1,
    value: 87,
    valueDecimals: 0,
    indexedTag1: "defi",
    tag1: "defi",
    tag2: "analytics",
    endpoint: "https://api.agent.example.com/v1",
    feedbackURI: "https://example.com/feedback/22-1.json",
    feedbackHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
  timestamp: 1767000000,
};

describe("normalizeErc8004FeedbackValue", () => {
  test("whole numbers pass through at zero decimals", () => {
    expect(normalizeErc8004FeedbackValue(87, 0)).toBe(87);
  });

  test("fixed point values scale down", () => {
    expect(normalizeErc8004FeedbackValue(475, 2)).toBe(4.75);
    expect(normalizeErc8004FeedbackValue(9977, 2)).toBe(99.77);
    expect(normalizeErc8004FeedbackValue(45, 1)).toBe(4.5);
  });

  test("negative string values normalize", () => {
    expect(normalizeErc8004FeedbackValue("-32", 1)).toBe(-3.2);
    expect(normalizeErc8004FeedbackValue("-2", 0)).toBe(-2);
  });
});

describe("erc8004ReputationRegistryNewFeedbackEventSchema", () => {
  test("parses a pipeline payload", () => {
    const parsed = erc8004ReputationRegistryNewFeedbackEventSchema.parse(newFeedbackEvent);

    expect(parsed.args.agentId).toBe(22);
    expect(parsed.args.value).toBe(87);
    expect(parsed.args.valueDecimals).toBe(0);
  });

  test("rejects valueDecimals above 18", () => {
    const parsed = erc8004ReputationRegistryNewFeedbackEventSchema.safeParse({
      ...newFeedbackEvent,
      args: { ...newFeedbackEvent.args, valueDecimals: 19 },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("erc8004ReputationRegistryFeedbackRevokedEventSchema", () => {
  test("parses a pipeline payload", () => {
    const parsed = erc8004ReputationRegistryFeedbackRevokedEventSchema.parse({
      id: "0xabc123-1",
      blockNumber: 42890010,
      transactionHash: "0xabc123",
      address: "0x8004baa17c55a88189ae136b182e5fda19de9b63",
      eventName: "ReputationRegistry:FeedbackRevoked",
      args: {
        agentId: 22,
        clientAddress: "0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
        feedbackIndex: 1,
      },
      timestamp: 1767000010,
    });

    expect(parsed.args.feedbackIndex).toBe(1);
  });
});

describe("erc8004ReputationRegistryResponseAppendedEventSchema", () => {
  test("parses a pipeline payload", () => {
    const parsed = erc8004ReputationRegistryResponseAppendedEventSchema.parse({
      id: "0xabc123-2",
      blockNumber: 42890020,
      transactionHash: "0xabc123",
      address: "0x8004baa17c55a88189ae136b182e5fda19de9b63",
      eventName: "ReputationRegistry:ResponseAppended",
      args: {
        agentId: 22,
        clientAddress: "0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
        feedbackIndex: 1,
        responder: "0x8004c269d0a5647e51e121feb226200ece932d55",
        responseURI: "https://example.com/response/22-1.json",
        responseHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      timestamp: 1767000020,
    });

    expect(parsed.args.responder).toBe("0x8004c269d0a5647e51e121feb226200ece932d55");
  });
});

describe("erc8004FeedbackFileSchema", () => {
  test("keeps reasoning and proof of payment, normalizes numeric chainId", () => {
    const parsed = erc8004FeedbackFileSchema.parse({
      agentRegistry: "eip155:84532:0x8004c269d0a5647e51e121feb226200ece932d55",
      agentId: 22,
      clientAddress: "eip155:84532:0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
      createdAt: "2026-01-20T12:00:00Z",
      value: "4.75",
      valueDecimals: 2,
      reasoning: "Excellent portfolio analysis service.",
      proofOfPayment: {
        fromAddress: "0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
        toAddress: "0x8004c269d0a5647e51e121feb226200ece932d55",
        chainId: 84532,
        txHash: "0xabc123",
      },
    });

    expect(parsed.reasoning).toBe("Excellent portfolio analysis service.");
    expect(parsed.proofOfPayment?.chainId).toBe("84532");
  });

  test("keeps string chainId untouched", () => {
    const parsed = erc8004FeedbackFileSchema.parse({
      proofOfPayment: {
        fromAddress: "0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
        toAddress: "0x8004c269d0a5647e51e121feb226200ece932d55",
        chainId: "84532",
        txHash: "0xabc123",
      },
    });

    expect(parsed.proofOfPayment?.chainId).toBe("84532");
  });

  test("parses a file with only the profile's required fields", () => {
    const parsed = erc8004FeedbackFileSchema.parse({
      agentRegistry: "eip155:84532:0x8004c269d0a5647e51e121feb226200ece932d55",
      agentId: 22,
      clientAddress: "eip155:84532:0x742d35cc6634c0532925a3b844bc9e7595f0beb0",
      createdAt: "2026-01-20T12:00:00Z",
      value: "5",
      valueDecimals: 0,
    });

    expect(parsed.reasoning).toBeUndefined();
    expect(parsed.proofOfPayment).toBeUndefined();
  });
});
