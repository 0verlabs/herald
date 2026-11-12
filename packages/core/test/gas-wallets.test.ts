import { describe, expect, test } from "vite-plus/test";
import {
  getGasWallets,
  type GasWalletAddressReader,
  type NativeBalanceReader,
} from "../src/server/index.ts";

const EVM_GAS = "0x0000000000000000000000000000000000009a5e";
const SOLANA_GAS = "GasWa11et1111111111111111111111111111111111";

/** Herald's gas wallets as the chain queues answer them: one EVM, one Solana. */
const gasWallets: GasWalletAddressReader = async (network) =>
  network.kind === "evm" ? EVM_GAS : SOLANA_GAS;

/**
 * Fake chains: native balances in base units keyed by `<network>/<owner>`.
 * Networks in `failing` answer with an error, like an RPC that's down.
 */
function fakeChains(balances: Record<string, string>, failing: string[] = []): NativeBalanceReader {
  return async ({ network, owner }) => {
    if (failing.includes(network.caip2)) throw new Error(`${network.label} RPC is down`);
    return balances[`${network.caip2}/${owner}`] ?? "0";
  };
}

describe("getGasWallets", () => {
  test("shows each chain's gas wallet and native balance, warning below its threshold", async () => {
    const readNativeBalance = fakeChains({
      // 0.01 ETH, above a 0.005 threshold.
      [`eip155:84532/${EVM_GAS}`]: "10000000000000000",
      // 0.02 SOL, below a 0.05 threshold.
      [`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/${SOLANA_GAS}`]: "20000000",
      // Exactly 0.005 ETH: at the threshold, not below it.
      [`eip155:421614/${EVM_GAS}`]: "5000000000000000",
    });

    const wallets = await getGasWallets(
      { gasWalletAddress: gasWallets, readNativeBalance },
      {
        env: "testnet",
        lowBalanceThresholds: {
          "eip155:84532": "0.005",
          "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "0.05",
          "eip155:421614": "0.005",
        },
      },
    );

    expect(wallets).toEqual([
      {
        network: "eip155:84532",
        label: "Base Sepolia",
        symbol: "ETH",
        decimals: 18,
        threshold: "5000000000000000",
        address: EVM_GAS,
        ok: true,
        balance: "10000000000000000",
        low: false,
      },
      {
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        label: "Solana Devnet",
        symbol: "SOL",
        decimals: 9,
        threshold: "50000000",
        address: SOLANA_GAS,
        ok: true,
        balance: "20000000",
        low: true,
      },
      {
        network: "eip155:421614",
        label: "Arbitrum Sepolia",
        symbol: "ETH",
        decimals: 18,
        threshold: "5000000000000000",
        address: EVM_GAS,
        ok: true,
        balance: "5000000000000000",
        low: false,
      },
    ]);
  });

  test("covers every mainnet chain, in their native tokens", async () => {
    const wallets = await getGasWallets(
      { gasWalletAddress: gasWallets, readNativeBalance: fakeChains({}) },
      { env: "mainnet", lowBalanceThresholds: { "eip155:137": "5" } },
    );

    expect(wallets.map((w) => [w.label, w.symbol])).toEqual([
      ["Base", "ETH"],
      ["Solana", "SOL"],
      ["Arbitrum", "ETH"],
      ["Polygon", "POL"],
      ["Avalanche", "AVAX"],
    ]);
    // An empty wallet is low against its threshold; without a threshold
    // there is nothing to warn about.
    expect(wallets.find((w) => w.label === "Polygon")).toMatchObject({ ok: true, low: true });
    expect(wallets.find((w) => w.label === "Base")).toMatchObject({
      ok: true,
      threshold: null,
      low: false,
    });
  });

  test("reports a chain it can't read without holding up the others", async () => {
    const wallets = await getGasWallets(
      {
        gasWalletAddress: async (network) => {
          if (network.kind === "solana") throw new Error("The Solana chain queue is down");
          return EVM_GAS;
        },
        readNativeBalance: fakeChains({}, ["eip155:421614"]),
        timeoutMs: 50,
      },
      { env: "testnet", lowBalanceThresholds: {} },
    );

    expect(wallets).toMatchObject([
      { label: "Base Sepolia", ok: true, address: EVM_GAS, balance: "0" },
      { label: "Solana Devnet", ok: false, address: null },
      { label: "Arbitrum Sepolia", ok: false, address: EVM_GAS },
    ]);
    const arbitrum = wallets[2];
    expect(arbitrum?.ok === false && arbitrum.message).toContain("Arbitrum Sepolia");
  });

  test("doesn't wait forever on a chain whose RPC never answers", async () => {
    const wallets = await getGasWallets(
      {
        gasWalletAddress: gasWallets,
        readNativeBalance: ({ network }) =>
          network.kind === "solana" ? new Promise(() => {}) : Promise.resolve("1"),
        timeoutMs: 50,
      },
      { env: "testnet", lowBalanceThresholds: {} },
    );

    expect(wallets.map((w) => w.ok)).toEqual([true, false, true]);
  });

  test("rejects thresholds that aren't amounts of the chain's native token", async () => {
    const read = (lowBalanceThresholds: unknown) =>
      getGasWallets(
        { gasWalletAddress: gasWallets, readNativeBalance: fakeChains({}) },
        { env: "testnet", lowBalanceThresholds },
      );

    await expect(read({ "eip155:84532": "-1" })).rejects.toThrow();
    await expect(read({ "eip155:84532": 0.005 })).rejects.toThrow();
    // A network Herald doesn't list, such as a typo, would never warn.
    await expect(read({ "eip155:84523": "0.005" })).rejects.toThrow("eip155:84523");
    // SOL has 9 decimal places.
    await expect(
      read({ "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "0.0000000001" }),
    ).rejects.toThrow();
    // A JSON string, as `.dev.vars` sets it, reads like the object.
    expect(await read('{"eip155:84532":"0.5"}')).toMatchObject([
      { threshold: "500000000000000000" },
      { threshold: null },
      { threshold: null },
    ]);
  });
});
