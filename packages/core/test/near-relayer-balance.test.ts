import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { NearRpcError, warnIfNearRelayerLow, type NearRpc } from "../src/server/index.ts";

const RELAYER = "ab".repeat(32);
const NEAR = 10n ** 24n;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A NEAR RPC answering `view_account` for the relayer as a node does: its
 * liquid `amount`, nothing `locked`, and the 182 bytes an implicit account
 * stores (0.00182 NEAR held back for storage).
 */
function nodeWith(account: { amount: bigint; locked?: bigint } | "missing" | "down"): NearRpc {
  return {
    name: "NEAR Testnet RPC",
    call: async (method, params) => {
      if (account === "down") throw new Error("NEAR Testnet RPC query failed: fetch failed");
      if (method !== "query" || params["request_type"] !== "view_account") {
        throw new Error(`Unexpected ${method}`);
      }
      if (account === "missing" || params["account_id"] !== RELAYER) {
        throw new NearRpcError("NEAR Testnet RPC refused query", "UNKNOWN_ACCOUNT", {});
      }
      return {
        amount: account.amount.toString(),
        locked: (account.locked ?? 0n).toString(),
        code_hash: "11111111111111111111111111111111",
        storage_usage: 182,
      };
    },
  };
}

/** The structured log lines written through `spy`, parsed. */
function events(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap(([line]) => {
    try {
      return [JSON.parse(String(line)) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

describe("warnIfNearRelayerLow", () => {
  test("warns with the network, the relayer, its available balance and the threshold when it is below", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await warnIfNearRelayerLow(
      { rpc: nodeWith({ amount: (4n * NEAR) / 10n }) },
      { network: "near:testnet", relayer: RELAYER, threshold: "0.5" },
    );

    expect(events(warn)).toEqual([
      {
        event: "near_relayer_low_balance",
        network: "near:testnet",
        relayer: RELAYER,
        // 0.4 NEAR, less the 0.00182 NEAR its storage holds back.
        balance: "0.39818",
        threshold: "0.5",
      },
    ]);
  });

  test.each([
    { case: "above it", amount: 2n * NEAR, locked: 0n },
    // 0.50182 NEAR liquid, 0.00182 of it held for storage: exactly 0.5 available.
    { case: "exactly at it", amount: 501_820_000_000_000_000_000_000n, locked: 0n },
    // Staked NEAR covering its storage: all 0.5 liquid NEAR is available.
    { case: "at it with storage covered by staked NEAR", amount: NEAR / 2n, locked: NEAR },
  ])("stays quiet when the available balance is $case", async ({ amount, locked }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await warnIfNearRelayerLow(
      { rpc: nodeWith({ amount, locked }) },
      { network: "near:testnet", relayer: RELAYER, threshold: "0.5" },
    );

    expect(events(warn)).toEqual([]);
    expect(events(error)).toEqual([]);
  });

  test("warns that a relayer that doesn't exist has nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await warnIfNearRelayerLow(
      { rpc: nodeWith("missing") },
      { network: "near:mainnet", relayer: RELAYER, threshold: "2" },
    );

    expect(events(warn)).toEqual([
      expect.objectContaining({
        event: "near_relayer_low_balance",
        network: "near:mainnet",
        balance: "0",
        threshold: "2",
      }),
    ]);
  });

  test("a balance that can't be read is logged, not thrown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      warnIfNearRelayerLow(
        { rpc: nodeWith("down") },
        { network: "near:testnet", relayer: RELAYER, threshold: "0.5" },
      ),
    ).resolves.toBeUndefined();

    expect(events(warn)).toEqual([
      {
        event: "near_relayer_balance_read_failed",
        network: "near:testnet",
        error: expect.stringContaining("fetch failed"),
      },
    ]);
  });

  test.each([undefined, "", "half", "-1", "0.0000000000000000000000001"])(
    "a threshold that isn't a NEAR amount (%j) is logged, and nothing is read",
    async (threshold) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const rpc = nodeWith({ amount: 0n });
      const call = vi.spyOn(rpc, "call");

      await warnIfNearRelayerLow({ rpc }, { network: "near:testnet", relayer: RELAYER, threshold });

      expect(call).not.toHaveBeenCalled();
      expect(events(error)).toEqual([
        expect.objectContaining({
          event: "near_relayer_low_balance_threshold_invalid",
          network: "near:testnet",
        }),
      ]);
    },
  );
});
