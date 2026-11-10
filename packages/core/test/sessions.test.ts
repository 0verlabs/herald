import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { endSession, readSession, registerProvider, startSession } from "../src/server/index.ts";

async function provider(accountId: string) {
  return registerProvider(createDb(env.DB), { accountId, env: "testnet" });
}

describe("sessions", () => {
  test("a started session reads back as its Provider until it expires", async () => {
    const alice = await provider("session-alice.testnet");

    const { token, session } = await startSession(env.SESSIONS, alice);

    expect(await readSession(env.SESSIONS, token)).toEqual(session);
    expect(session).toMatchObject({ providerId: alice.id, accountId: "session-alice.testnet" });
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  test("an ended session no longer reads", async () => {
    const { token } = await startSession(env.SESSIONS, await provider("session-bob.testnet"));

    await endSession(env.SESSIONS, token);

    expect(await readSession(env.SESSIONS, token)).toBeNull();
  });

  test("a session started in place of another ends the old one", async () => {
    const carol = await provider("session-carol.testnet");
    const planted = await startSession(env.SESSIONS, carol);

    const fresh = await startSession(env.SESSIONS, carol, { replacing: planted.token });

    expect(await readSession(env.SESSIONS, planted.token)).toBeNull();
    expect(await readSession(env.SESSIONS, fresh.token)).toEqual(fresh.session);
  });

  test("a token Herald didn't issue reads as no session", async () => {
    expect(await readSession(env.SESSIONS, "made-up-token")).toBeNull();
    expect(await readSession(env.SESSIONS, undefined)).toBeNull();
  });
});
