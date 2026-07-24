import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function userMessage(text: string) {
  return { id: "message-1", role: "user", parts: [{ type: "text", text }] };
}

async function post(body: unknown) {
  const request = new IncomingRequest("http://example.com/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("POST /chat", () => {
  it("rejects an empty message list", async () => {
    const response = await post({ messages: [] });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown model", async () => {
    const response = await post({
      messages: [userMessage("hi")],
      model: "not-a-model",
    });
    expect(response.status).toBe(400);
  });

  it("rejects a malformed message shape", async () => {
    const response = await post({ messages: [{ role: "user", content: "hi" }] });
    expect(response.status).toBe(400);
  });

  it("fails with a config error when the provider key is missing", async () => {
    // No `MINIMAX_API_KEY` secret in the test env, so the default model's
    // provider is unconfigured.
    const response = await post({ messages: [userMessage("hi")] });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Provider "minimax" is not configured: set MINIMAX_API_URL and MINIMAX_API_KEY',
    });
  });

  it("returns 404 for unknown routes", async () => {
    const request = new IncomingRequest("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});
