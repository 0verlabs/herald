import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

describe("GET /health", () => {
  test("reports the Worker healthy once D1 answers", async () => {
    const response = await exports.default.fetch("http://facilitator.test/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "facilitator",
      network: "testnet",
    });
  });

  test("runs against a D1 database with Herald's migrations applied", async () => {
    const tables = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name = 'providers'",
    ).all();

    expect(tables.results).toEqual([{ name: "providers" }]);
  });
});
