import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { AgentId } from "@hrld/core";
import { agentFeedbackSchema } from "@hrld/core";
import * as schema from "@hrld/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";

import "./setup";

const app = await import("../src/index").then((m) => m.default);
const db = drizzle(process.env.DATABASE_URL as string, { schema });

const feedbackListResponseSchema = z.object({
  data: agentFeedbackSchema.array(),
  next: z.number().nullable(),
});

const agentId = "0g_77" as AgentId;
const onchainId = 77;
const clientAddress = "0x742d35cc6634c0532925a3b844bc9e7595f0beb0";

// A real HTTP server standing in for the offchain feedbackURI file, so the
// sync path exercises an actual fetch instead of a mock.
const feedbackFileServer = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      JSON.stringify({
        agentRegistry: "eip155:16600:0x8004c269d0a5647e51e121feb226200ece932d55",
        agentId: onchainId,
        clientAddress,
        createdAt: "2026-01-20T12:00:00Z",
        value: "4.75",
        valueDecimals: 2,
        reasoning: "Excellent portfolio analysis service.",
        proofOfPayment: {
          fromAddress: clientAddress,
          toAddress: "0x8004c269d0a5647e51e121feb226200ece932d55",
          chainId: 84532,
          txHash: "0xabc123",
        },
      }),
      { headers: { "content-type": "application/json" } }
    ),
});

const event = (eventName: string, args: Record<string, unknown>) => ({
  id: "0xtestevent",
  blockNumber: 42890000,
  transactionHash: "0xabc123",
  address: "0x8004baa17c55a88189ae136b182e5fda19de9b63",
  eventName,
  args,
  timestamp: 1767000000,
});

const newFeedbackArgs = (overrides: Record<string, unknown>) => ({
  agentId: onchainId,
  clientAddress,
  feedbackIndex: 1,
  value: 475,
  valueDecimals: 2,
  indexedTag1: "defi",
  tag1: "defi",
  tag2: "analytics",
  endpoint: "https://api.agent.example.com/v1",
  feedbackURI: `http://localhost:${feedbackFileServer.port}/feedback.json`,
  feedbackHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  ...overrides,
});

const postEvent = (payload: unknown) =>
  app.request("/webhook/goldsky/0g", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.GOLDSKY_WEBHOOK_SECRET}`,
    },
    body: JSON.stringify({ payload: JSON.stringify(payload) }),
  });

const getAgent = async () => {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));

  return agent;
};

beforeAll(async () => {
  await db.delete(schema.agents).where(eq(schema.agents.id, agentId));

  await db.insert(schema.agents).values({
    id: agentId,
    chain: "0g",
    onchain_id: onchainId,
    name: "Test Agent",
    description: "Test agent description",
    image: "https://example.com/a.png",
    score: 0,
    feedback_counts: 0,
    wallet: null,
    owner: "0x1111111111111111111111111111111111111111",
    active: true,
  });
});

afterAll(async () => {
  feedbackFileServer.stop(true);
  await db.delete(schema.agents).where(eq(schema.agents.id, agentId));
});

describe("feedback sync", () => {
  test("inserts feedback with a normalized value and the offchain file context", async () => {
    const res = await postEvent(event("ReputationRegistry:NewFeedback", newFeedbackArgs({})));

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.agentFeedback)
      .where(
        and(eq(schema.agentFeedback.agent_id, agentId), eq(schema.agentFeedback.feedback_index, 1))
      );

    expect(row?.value).toBe(4.75);
    expect(row?.client_address).toBe(clientAddress);
    expect(row?.reasoning).toBe("Excellent portfolio analysis service.");
    expect(row?.proof_of_payment?.chainId).toBe("84532");
    expect(row?.revoked_at).toBeNull();

    const agent = await getAgent();
    expect(agent?.score).toBe(5);
    expect(agent?.feedback_counts).toBe(1);
  });

  test("retries are idempotent", async () => {
    const res = await postEvent(event("ReputationRegistry:NewFeedback", newFeedbackArgs({})));

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.agentFeedback)
      .where(eq(schema.agentFeedback.agent_id, agentId));

    expect(rows).toHaveLength(1);

    const agent = await getAgent();
    expect(agent?.feedback_counts).toBe(1);
  });

  test("stores out-of-scale values but keeps them out of the score", async () => {
    const res = await postEvent(
      event(
        "ReputationRegistry:NewFeedback",
        newFeedbackArgs({ feedbackIndex: 2, value: 560, valueDecimals: 0, feedbackURI: "" })
      )
    );

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.agentFeedback)
      .where(
        and(eq(schema.agentFeedback.agent_id, agentId), eq(schema.agentFeedback.feedback_index, 2))
      );

    expect(row?.value).toBe(560);

    const agent = await getAgent();
    expect(agent?.score).toBe(5);
    expect(agent?.feedback_counts).toBe(1);
  });

  test("acks feedback for unregistered agents without storing it", async () => {
    const res = await postEvent(
      event("ReputationRegistry:NewFeedback", newFeedbackArgs({ agentId: 9999, feedbackIndex: 1 }))
    );

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.agentFeedback)
      .where(eq(schema.agentFeedback.agent_id, agentId));

    expect(rows).toHaveLength(2);
  });

  test("accepts ResponseAppended events", async () => {
    const res = await postEvent(
      event("ReputationRegistry:ResponseAppended", {
        agentId: onchainId,
        clientAddress,
        feedbackIndex: 1,
        responder: "0x8004c269d0a5647e51e121feb226200ece932d55",
        responseURI: "https://example.com/response.json",
        responseHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      })
    );

    expect(res.status).toBe(200);
  });

  test("lists non-revoked feedback for an agent", async () => {
    const res = await app.request(`/agents/${agentId}/feedback`);

    expect(res.status).toBe(200);

    const body = feedbackListResponseSchema.parse(await res.json());
    const values = body.data.map((feedback) => feedback.value).sort();

    expect(values).toEqual([4.75, 560]);

    const scored = body.data.find((feedback) => feedback.value === 4.75);
    expect(scored?.reasoning).toBe("Excellent portfolio analysis service.");
    expect(scored?.proofOfPayment?.txHash).toBe("0xabc123");
    expect(scored?.revoked).toBe(false);
  });

  test("returns 404 for an unknown agent's feedback", async () => {
    const res = await app.request("/agents/0g_999/feedback");

    expect(res.status).toBe(404);
  });

  test("revocation marks the row and recomputes the score", async () => {
    const res = await postEvent(
      event("ReputationRegistry:FeedbackRevoked", {
        agentId: onchainId,
        clientAddress,
        feedbackIndex: 1,
      })
    );

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.agentFeedback)
      .where(
        and(eq(schema.agentFeedback.agent_id, agentId), eq(schema.agentFeedback.feedback_index, 1))
      );

    expect(row?.revoked_at).not.toBeNull();

    const agent = await getAgent();
    expect(agent?.score).toBe(0);
    expect(agent?.feedback_counts).toBe(0);

    const list = await app.request(`/agents/${agentId}/feedback`);
    const body = feedbackListResponseSchema.parse(await list.json());

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.value).toBe(560);
  });
});
