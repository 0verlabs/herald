import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { FakeNearChain } from "./support/fake-near-chain.ts";
import { installFakeNetwork, NEAR_TESTNET, nearRelayer } from "./support/network.ts";
import { buyerPayment, facilitatorClient, registeredProvider } from "./support/parties.ts";

// The NEAR relayer's low-balance warning: after each relayer transaction,
// the NEAR chain queue reads the relayer's balance on the side and logs
// `near_relayer_low_balance` below NEAR_RELAYER_LOW_BALANCE_THRESHOLD
// (0.5 NEAR in the test config, wrangler.jsonc's top level).

afterEach(() => {
  vi.restoreAllMocks();
});

const NEAR = 10n ** 24n;

type JsonRpcCall = { method: string; params?: Record<string, unknown> };

function isRelayerBalanceRead(call: JsonRpcCall): boolean {
  return (
    call.method === "query" &&
    call.params?.["request_type"] === "view_account" &&
    call.params?.["account_id"] === nearRelayer().accountId
  );
}

/**
 * Holds every read of the relayer's account on `near` until the test calls
 * `release`, answering it then as `answer` says. `reads` resolves once the
 * first one has come in.
 */
function holdRelayerBalanceReads(near: FakeNearChain, answer: "balance" | "error" = "balance") {
  const handle = near.handle.bind(near);
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let arrived!: () => void;
  const reads = new Promise<void>((resolve) => (arrived = resolve));
  const answered: Promise<unknown>[] = [];
  vi.spyOn(near, "handle").mockImplementation(async (call) => {
    if (!isRelayerBalanceRead(call as JsonRpcCall)) return handle(call);
    arrived();
    const reply = released.then(() => {
      // As a runtime reports an endpoint it can't reach.
      if (answer === "error") throw new TypeError("fetch failed");
      return handle(call);
    });
    answered.push(reply);
    return reply;
  });
  return {
    reads,
    /** Answers the held reads, resolving once the queue has had them. */
    release: async () => {
      release();
      await Promise.allSettled(answered);
      // Let the queue act on the answer.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

/** Settles a Buyer's 0.001 USDC payment on NEAR Testnet through the facilitator. */
async function settleOnNear(near: FakeNearChain, accountId: string) {
  const { provider, secret } = await registeredProvider(accountId);
  near.registerStorage(provider.nearAddress);
  const { payload, requirements } = await buyerPayment({
    providerAccount: accountId,
    network: NEAR_TESTNET,
    apiKey: secret,
    near,
  });
  return facilitatorClient(secret).settle(payload, requirements);
}

function events(spy: { mock: { calls: unknown[][] } }, event: string): unknown[] {
  return spy.mock.calls.flatMap(([line]) => {
    try {
      const entry = JSON.parse(String(line)) as { event?: unknown };
      return entry.event === event ? [entry] : [];
    } catch {
      return [];
    }
  });
}

describe("the NEAR relayer's low-balance warning", () => {
  test("a settlement by a relayer below the threshold settles, then warns with the network, the balance and the threshold", async () => {
    const fake = installFakeNetwork();
    const relayer = nearRelayer();
    fake.near.addAccount(relayer.accountId, relayer.publicKey, NEAR / 10n);
    const warn = vi.spyOn(console, "warn");
    const held = holdRelayerBalanceReads(fake.near);

    // Settled while the balance read is still unanswered: it doesn't wait on it.
    const settled = await settleOnNear(fake.near, "relayer-runs-low.testnet");
    expect(settled).toMatchObject({ success: true, network: NEAR_TESTNET });
    await held.reads;
    expect(events(warn, "near_relayer_low_balance")).toEqual([]);

    await held.release();
    expect(events(warn, "near_relayer_low_balance")).toEqual([
      {
        event: "near_relayer_low_balance",
        network: NEAR_TESTNET,
        relayer: relayer.accountId,
        // 0.1 NEAR, less the 0.00182 NEAR its storage holds back.
        balance: "0.09818",
        threshold: "0.5",
      },
    ]);
  });

  test("a settlement by a relayer above the threshold doesn't warn", async () => {
    const fake = installFakeNetwork();
    const warn = vi.spyOn(console, "warn");
    const held = holdRelayerBalanceReads(fake.near);

    const settled = await settleOnNear(fake.near, "relayer-funded.testnet");
    await held.reads;
    await held.release();

    expect(settled).toMatchObject({ success: true, network: NEAR_TESTNET });
    expect(events(warn, "near_relayer_low_balance")).toEqual([]);
  });

  test("a balance that can't be read doesn't fail the settlement, and is logged", async () => {
    const fake = installFakeNetwork();
    const warn = vi.spyOn(console, "warn");
    const held = holdRelayerBalanceReads(fake.near, "error");

    const settled = await settleOnNear(fake.near, "relayer-unreadable.testnet");
    await held.reads;
    await held.release();

    expect(settled).toMatchObject({ success: true, network: NEAR_TESTNET });
    expect(fake.near.transfers).toHaveLength(1);
    expect(events(warn, "near_relayer_balance_read_failed")).toEqual([
      expect.objectContaining({ network: NEAR_TESTNET }),
    ]);
  });
});
