import { beforeAll, describe, expect, test } from "bun:test";

import type { AgentId } from "@hrld/core";
import * as schema from "@hrld/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { testClient } from "hono/testing";

import "./setup";

const app = await import("../src/index").then((m) => m.default);
const client = testClient(app);
const db = drizzle(process.env.DATABASE_URL as string, { schema });

// Two agents on different chains so every assertion can prove the `chain`
// filter is applied, plus an inactive one for the /agents active filter.
const mainnet = "0g_1" as AgentId;
const testnet = "0g-testnet_1" as AgentId;
const inactive = "0g_2" as AgentId;

const agent = (id: AgentId, chain: "0g" | "0g-testnet", name: string, active = true) => ({
  id,
  chain,
  onchain_id: Number(id.split("_")[1]),
  name,
  description: `${name} description`,
  image: "https://example.com/a.png",
  category: "research",
  score: 50,
  feedback_counts: 0,
  wallet: null,
  owner: "0x1111111111111111111111111111111111111111",
  active,
});

beforeAll(async () => {
  await db.delete(schema.agents);

  await db
    .insert(schema.agents)
    .values([
      agent(mainnet, "0g", "Cartographer"),
      agent(testnet, "0g-testnet", "Cartographer"),
      agent(inactive, "0g", "Retired Scribe", false),
    ]);

  await db.insert(schema.agentJobServices).values([
    { agent_id: mainnet, title: "Translate a manuscript", description: "Latin to English" },
    { agent_id: testnet, title: "Translate a manuscript", description: "Latin to English" },
  ]);

  await db.insert(schema.agentApiServices).values(
    [mainnet, testnet].map((agent_id) => ({
      agent_id,
      name: "geocode",
      method: "GET" as const,
      endpoint: "/geocode",
      version: "1.0.0",
      description: "Resolve a place name to coordinates",
    }))
  );

  await db.insert(schema.agentMcpServices).values(
    [mainnet, testnet].map((agent_id) => ({
      agent_id,
      endpoint: "https://example.com/mcp",
      version: "1.0.0",
      tools: ["render_map", "reproject"],
      resources: ["atlas"],
      prompts: ["describe_region"],
    }))
  );
});

describe("GET /agents", () => {
  test("returns only active agents on the default chain", async () => {
    const res = await client.agents.$get({ query: {} });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const body = await res.json();

    expect(body.data.map((a) => a.id)).toEqual([mainnet]);
    expect(body.next).toBeNull();
  });

  test("scopes results to the requested chain", async () => {
    const res = await client.agents.$get({ query: { chain: "0g-testnet" } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    expect((await res.json()).data.map((a) => a.id)).toEqual([testnet]);
  });

  test("matches a fuzzy name query with a typo", async () => {
    const res = await client.agents.$get({ query: { q: "Cartogapher" } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    expect((await res.json()).data.map((a) => a.id)).toEqual([mainnet]);
  });
});

describe.each([
  ["job", "Translate", "trnaslate"],
  ["api", "geocode", "gecode"],
  ["mcp", "render_map", "render_mpa"],
] as const)("GET /agents/services/%s", (kind, exactQuery, fuzzyQuery) => {
  const endpoint = () => client.agents.services[kind];

  test("returns the service with its owning agent summary", async () => {
    const res = await endpoint().$get({ query: {} });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.agent).toMatchObject({ id: mainnet, name: "Cartographer" });
    // agentId is redundant once the agent summary is inlined.
    expect(body.data[0]).not.toHaveProperty("agentId");
  });

  test("scopes results and total to the requested chain", async () => {
    const res = await endpoint().$get({ query: { chain: "0g-testnet" } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.data[0]?.agent.id).toBe(testnet);
  });

  test("matches an exact substring query", async () => {
    const res = await endpoint().$get({ query: { q: exactQuery } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    expect((await res.json()).data).toHaveLength(1);
  });

  test("matches a fuzzy query with a typo", async () => {
    const res = await endpoint().$get({ query: { q: fuzzyQuery } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    expect((await res.json()).data).toHaveLength(1);
  });

  test("filters by agentId", async () => {
    const res = await endpoint().$get({ query: { agentId: testnet, chain: "0g-testnet" } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.data[0]?.agent.id).toBe(testnet);
  });

  test("returns an empty page past the end of the results", async () => {
    const res = await endpoint().$get({ query: { page: "2" } });

    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const body = await res.json();

    expect(body.data).toEqual([]);
    expect(body.total).toBe(1);
  });
});

describe("GET /agents/:agentId", () => {
  test("returns the agent with its service counts", async () => {
    const res = await client.agents[":agentId"].$get({ param: { agentId: mainnet } });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: mainnet,
      name: "Cartographer",
      serviceCounts: { job: 1, api: 1, mcp: 1 },
    });
  });

  test("404s for an unknown agent", async () => {
    const res = await client.agents[":agentId"].$get({ param: { agentId: "0g_999" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
  });
});
