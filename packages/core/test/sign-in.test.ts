import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  createSignInChallenge,
  nearRpcAccessKeyReader,
  setSolanaTokenAccountStatus,
  signIn,
  type NearAccessKeyReader,
  type SolanaTokenAccountJob,
  type SolanaTokenAccountQueue,
} from "../src/server/index.ts";
import { fakeNearAccounts, nearKey, walletSignature } from "./support/near.ts";

const recipient = "dashboard.herald.test";

afterEach(() => {
  vi.useRealTimers();
});

/** One Provider Account with one access key of the given permission. */
function account(accountId: string, permission: "full_access" | "limited" = "full_access") {
  const key = nearKey();
  return { accountId, key, readAccessKey: fakeNearAccounts({ [accountId]: [[key, permission]] }) };
}

/** A fake Solana chain queue that records the token accounts it's asked to create. */
function fakeSolanaChainQueue() {
  const jobs: SolanaTokenAccountJob[] = [];
  const queueSolanaTokenAccount: SolanaTokenAccountQueue = async (job) => {
    jobs.push(job);
  };
  return { jobs, queueSolanaTokenAccount };
}

async function signInWith(
  readAccessKey: NearAccessKeyReader,
  signature: unknown,
  {
    queueSolanaTokenAccount,
  }: { queueSolanaTokenAccount: SolanaTokenAccountQueue } = fakeSolanaChainQueue(),
) {
  const db = createDb(env.DB);
  return signIn(
    { db, readAccessKey, queueSolanaTokenAccount },
    { env: "testnet", recipient, signature },
  );
}

async function challenge() {
  return createSignInChallenge(createDb(env.DB), { env: "testnet", recipient });
}

describe("signIn", () => {
  test("signs a Provider in with a full-access key and registers its Receiving Addresses", async () => {
    const db = createDb(env.DB);
    const key = nearKey();
    const readAccessKey = fakeNearAccounts({ "herald-test.near": [[key, "full_access"]] });
    const challenge = await createSignInChallenge(db, { env: "mainnet", recipient });
    const signature = await walletSignature({ accountId: "herald-test.near", challenge, key });
    const { queueSolanaTokenAccount } = fakeSolanaChainQueue();

    const result = await signIn(
      { db, readAccessKey, queueSolanaTokenAccount },
      { env: "mainnet", recipient, signature },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: {
        accountId: "herald-test.near",
        // Recorded from v1.signer (see #1).
        evmAddress: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
        solanaAddress: "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq",
      },
    });
  });

  test("signing in again returns the Provider registered the first time", async () => {
    const { accountId, key, readAccessKey } = account("returning.testnet");
    const first = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
    );

    const second = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.provider).toEqual(first.provider);
  });

  test("rejects a signature made with another key than the one presented", async () => {
    const { accountId, key, readAccessKey } = account("wrong-key.testnet");
    const signature = await walletSignature({
      accountId,
      challenge: await challenge(),
      key: nearKey(),
      presentedKey: key,
    });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("rejects a signature for another recipient", async () => {
    const { accountId, key, readAccessKey } = account("phished.testnet");
    const signature = await walletSignature({
      accountId,
      challenge: await challenge(),
      key,
      recipient: "evil.example",
    });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("rejects a key that isn't on the claimed account", async () => {
    const { readAccessKey } = account("victim.testnet");
    const signature = await walletSignature({
      accountId: "victim.testnet",
      challenge: await challenge(),
      key: nearKey(),
    });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "unknown_key",
    });
  });

  test("rejects a function-call key", async () => {
    const { accountId, key, readAccessKey } = account("limited-key.testnet", "limited");
    const signature = await walletSignature({ accountId, challenge: await challenge(), key });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "not_full_access",
    });
  });

  test("rejects a replayed signature, since each nonce works once", async () => {
    const { accountId, key, readAccessKey } = account("replayed.testnet");
    const signature = await walletSignature({ accountId, challenge: await challenge(), key });
    expect(await signInWith(readAccessKey, signature)).toMatchObject({ ok: true });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "unknown_nonce",
    });
  });

  test("rejects a nonce Herald didn't issue", async () => {
    const { accountId, key, readAccessKey } = account("made-up-nonce.testnet");
    const madeUp = { ...(await challenge()), nonce: btoa("x".repeat(32)) };
    const signature = await walletSignature({ accountId, challenge: madeUp, key });

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "unknown_nonce",
    });
  });

  test("rejects an expired challenge", async () => {
    const { accountId, key, readAccessKey } = account("slow-signer.testnet");
    const issued = await challenge();
    const signature = await walletSignature({ accountId, challenge: issued, key });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(issued.expiresAt.getTime() + 1);

    expect(await signInWith(readAccessKey, signature)).toMatchObject({
      ok: false,
      reason: "unknown_nonce",
    });
  });

  test("reports NEAR RPC being unreachable as a rejection, without repeating the RPC's error", async () => {
    const { accountId, key } = account("rpc-down.testnet");
    const signature = await walletSignature({ accountId, challenge: await challenge(), key });
    // The endpoint's URL carries its API key, and an error may name it.
    const unreachable: NearAccessKeyReader = async () => {
      throw new Error("fetch to https://near.example/api-key-1234 failed");
    };

    const result = await signInWith(unreachable, signature);

    expect(result).toMatchObject({ ok: false, reason: "near_rpc_failed" });
    expect(result.ok ? "" : result.message).not.toContain("api-key-1234");
  });

  test("rejects a malformed request", async () => {
    const { readAccessKey } = account("malformed.testnet");

    expect(
      await signInWith(readAccessKey, { accountId: "Not An Account", publicKey: "x" }),
    ).toMatchObject({ ok: false, reason: "invalid_request" });
  });
});

describe("the Provider's Solana USDC token account", () => {
  test("the first sign-in queues its creation on the Herald environment's Solana network", async () => {
    const { accountId, key, readAccessKey } = account("token-account.testnet");
    const queue = fakeSolanaChainQueue();

    const result = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );

    if (!result.ok) throw new Error(result.message);
    expect(result.provider.solanaTokenAccountStatus).toBe("queued");
    expect(queue.jobs).toEqual([
      {
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        providerId: result.provider.id,
        owner: result.provider.solanaAddress,
      },
    ]);
  });

  test("is handed to the chain queue again at each sign-in until it's created", async () => {
    // The chain queue creates it at most once (see the facilitator's
    // solana-token-accounts tests); handing it over again recovers a job
    // the queue never received, which D1 still shows as queued.
    const { accountId, key, readAccessKey } = account("token-account-again.testnet");
    const queue = fakeSolanaChainQueue();
    const signInAgain = async () =>
      signInWith(
        readAccessKey,
        await walletSignature({ accountId, challenge: await challenge(), key }),
        queue,
      );

    await signInAgain();
    const second = await signInAgain();

    expect(second).toMatchObject({ ok: true, provider: { solanaTokenAccountStatus: "queued" } });
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[1]).toEqual(queue.jobs[0]);
  });

  test("when the chain queue can't be reached, sign-in still succeeds and the next sign-in queues it", async () => {
    const { accountId, key, readAccessKey } = account("token-account-retry.testnet");
    const unreachable: SolanaTokenAccountQueue = async () => {
      throw new Error("Durable Object unreachable");
    };
    const queue = fakeSolanaChainQueue();

    const first = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      { queueSolanaTokenAccount: unreachable },
    );
    const second = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );

    expect(first).toMatchObject({ ok: true, provider: { solanaTokenAccountStatus: "not_queued" } });
    expect(second).toMatchObject({ ok: true, provider: { solanaTokenAccountStatus: "queued" } });
    expect(queue.jobs).toHaveLength(1);
  });

  test("a token account the chain queue gave up on is queued again at the next sign-in", async () => {
    const { accountId, key, readAccessKey } = account("token-account-failed.testnet");
    const queue = fakeSolanaChainQueue();
    const first = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );
    if (!first.ok) throw new Error(first.message);
    await setSolanaTokenAccountStatus(createDb(env.DB), {
      providerId: first.provider.id,
      status: "failed",
    });

    const second = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );

    expect(second).toMatchObject({ ok: true, provider: { solanaTokenAccountStatus: "queued" } });
    expect(queue.jobs).toHaveLength(2);
  });

  test("a created token account isn't queued again", async () => {
    const { accountId, key, readAccessKey } = account("token-account-created.testnet");
    const queue = fakeSolanaChainQueue();
    const first = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );
    if (!first.ok) throw new Error(first.message);
    await setSolanaTokenAccountStatus(createDb(env.DB), {
      providerId: first.provider.id,
      status: "created",
    });

    const second = await signInWith(
      readAccessKey,
      await walletSignature({ accountId, challenge: await challenge(), key }),
      queue,
    );

    expect(second).toMatchObject({ ok: true, provider: { solanaTokenAccountStatus: "created" } });
    expect(queue.jobs).toHaveLength(1);
  });
});

describe("nearRpcAccessKeyReader", () => {
  // Replies as rpc.testnet.fastnear.com sent them on 2026-11-10.
  const block = {
    block_hash: "4ParAnwAXGgrUPiALdKyWKT6rck7qwpwCP8YMYikFUhc",
    block_height: 277049685,
  };
  const replies = {
    fullAccess: { result: { ...block, nonce: 0, permission: "FullAccess" } },
    functionCall: {
      result: {
        ...block,
        nonce: 3,
        permission: {
          FunctionCall: { allowance: null, receiver_id: "app.testnet", method_names: [] },
        },
      },
    },
    missing: {
      result: {
        ...block,
        error:
          "access key ed25519:AtH7GEjv2qmBVoT8qoRhWXizXM5CC12DC6tiqY9iNoRm does not exist while viewing",
        logs: [],
      },
    },
    unknownAccount: {
      error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} } },
    },
  };
  const request = {
    accountId: "alice.testnet",
    publicKey: "ed25519:AtH7GEjv2qmBVoT8qoRhWXizXM5CC12DC6tiqY9iNoRm",
  };

  function rpcAnswering(reply: object, status = 200) {
    const fetchFn: typeof fetch = async () =>
      Response.json({ jsonrpc: "2.0", id: "herald", ...reply }, { status });
    return nearRpcAccessKeyReader("https://rpc.test", fetchFn);
  }

  test.each([
    ["a full-access key", replies.fullAccess, "full_access"],
    ["a function-call key", replies.functionCall, "limited"],
    ["a key the account doesn't have", replies.missing, null],
    ["an account that doesn't exist", replies.unknownAccount, null],
  ])("reads %s", async (_case, reply, expected) => {
    expect(await rpcAnswering(reply)(request)).toBe(expected);
  });

  test.each([
    [
      "answers 503",
      async () => new Response("down at https://near.example/api-key-1234", { status: 503 }),
    ],
    [
      "can't be reached",
      async () => {
        throw new TypeError("fetch failed: https://near.example/api-key-1234");
      },
    ],
  ])("never names the endpoint in its error when the RPC %s", async (_case, fetchFn) => {
    const read = nearRpcAccessKeyReader("https://near.example/api-key-1234", fetchFn);

    const error: unknown = await read(request).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("api-key-1234");
  });

  test("throws when the RPC fails", async () => {
    await expect(rpcAnswering({}, 503)(request)).rejects.toThrow("503");
    await expect(
      rpcAnswering({ error: { name: "INTERNAL_ERROR", cause: { name: "TIMEOUT_ERROR" } } })(
        request,
      ),
    ).rejects.toThrow("TIMEOUT_ERROR");
  });
});
