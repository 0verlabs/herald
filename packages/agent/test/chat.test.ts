import { describe, expect, test } from "bun:test";

import "./setup";

const app = await import("../src/index").then((m) => m.default);

const message = { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] };

describe("chat", () => {
  test("serves chat at the root path", async () => {
    // 404 would mean the route moved; the request is unauthenticated so 401 is
    // as far as it gets.
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [message] }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  test("no longer serves /chat", async () => {
    const res = await app.request("/chat", { method: "POST" });

    expect(res.status).toBe(404);
  });

  test("no longer serves /webhook/privy", async () => {
    const res = await app.request("/webhook/privy", { method: "POST" });

    expect(res.status).toBe(404);
  });

  test("rejects an empty message list", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(400);
  });
});
