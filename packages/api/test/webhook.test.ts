import { describe, expect, test } from "bun:test";

import "./setup";

const app = await import("../src/index").then((m) => m.default);

describe("privy webhook", () => {
  test("rejects a request without svix signature headers", async () => {
    const res = await app.request("/webhook/privy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "user.wallet_created" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_signature" });
  });

  test("rejects a forged signature", async () => {
    const res = await app.request("/webhook/privy", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_test",
        "svix-signature": "v1,not-a-real-signature",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ type: "user.wallet_created" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_signature" });
  });

  test("does not serve the agent chat route", async () => {
    const res = await app.request("/", { method: "POST" });

    expect(res.status).toBe(404);
  });
});
