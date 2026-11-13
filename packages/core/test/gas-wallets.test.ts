import { describe, expect, test } from "vite-plus/test";
import { findNetwork, unhandledKind } from "../src/index.ts";
import {
  getGasWallets,
  rpcNativeBalanceReader,
  type GasWalletAddressReader,
  type NativeBalanceReader,
} from "../src/server/index.ts";

const EVM_GAS = "0x0000000000000000000000000000000000009a5e";
const SOLANA_GAS = "GasWa11et1111111111111111111111111111111111";
const NEAR_RELAYER = "ab".repeat(32);

/** Herald's gas wallets as the chain queues answer them: one EVM, one Solana, the NEAR relayer. */
const gasWallets: GasWalletAddressReader = async (network) => {
  switch (network.kind) {
    case "evm":
      return EVM_GAS;
    case "solana":
      return SOLANA_GAS;
    case "near":
      return NEAR_RELAYER;
    default:
      return unhandledKind(network);
  }
};

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
      // 0.4 NEAR, below a 0.5 threshold.
      [`near:testnet/${NEAR_RELAYER}`]: "400000000000000000000000",
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
          "near:testnet": "0.5",
          "eip155:84532": "0.005",
          "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "0.05",
          "eip155:421614": "0.005",
        },
      },
    );

    expect(wallets).toEqual([
      {
        network: "near:testnet",
        label: "NEAR Testnet",
        symbol: "NEAR",
        decimals: 24,
        threshold: "500000000000000000000000",
        address: NEAR_RELAYER,
        ok: true,
        balance: "400000000000000000000000",
        low: true,
      },
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
      ["NEAR", "NEAR"],
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
      { label: "NEAR Testnet", ok: true, address: EVM_GAS, balance: "0" },
      { label: "Base Sepolia", ok: true, address: EVM_GAS, balance: "0" },
      { label: "Solana Devnet", ok: false, address: null },
      { label: "Arbitrum Sepolia", ok: false, address: EVM_GAS },
    ]);
    const arbitrum = wallets[3];
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

    expect(wallets.map((w) => w.ok)).toEqual([true, true, false, true]);
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
      { threshold: null },
      { threshold: "500000000000000000" },
      { threshold: null },
      { threshold: null },
    ]);
  });
});

describe("getGasWallets with no NEAR relayer", () => {
  test("shows NEAR as unavailable and every other chain's gas wallet", async () => {
    // As the NEAR chain queue answers without a NEAR_RELAYER_KEY.
    const wallets = await getGasWallets(
      {
        gasWalletAddress: async (network) => {
          if (network.kind === "near") throw new Error("The NEAR_RELAYER_KEY secret is not set");
          return gasWallets(network);
        },
        readNativeBalance: fakeChains({}),
      },
      { env: "testnet", lowBalanceThresholds: { "near:testnet": "0.5" } },
    );

    expect(wallets).toMatchObject([
      { label: "NEAR Testnet", ok: false, address: null, threshold: "500000000000000000000000" },
      { label: "Base Sepolia", ok: true, address: EVM_GAS },
      { label: "Solana Devnet", ok: true, address: SOLANA_GAS },
      { label: "Arbitrum Sepolia", ok: true, address: EVM_GAS },
    ]);
  });
});

describe("low-balance thresholds", () => {
  test("warn when the NEAR mainnet relayer is below its threshold", async () => {
    const wallets = await getGasWallets(
      { gasWalletAddress: gasWallets, readNativeBalance: fakeChains({}) },
      { env: "mainnet", lowBalanceThresholds: { "near:mainnet": "0.5", "eip155:8453": "0.002" } },
    );

    expect(wallets[0]).toMatchObject({
      network: "near:mainnet",
      label: "NEAR",
      threshold: "500000000000000000000000",
      low: true,
    });
    expect(wallets.find((w) => w.label === "Base")).toMatchObject({ low: true });
  });
});

// A private endpoint: the path stands in for an API key.
const NEAR_RPC_URL = "https://near-testnet.rpc.test/secret-api-key/";

/**
 * A fake NEAR RPC node: `accounts` maps account ids to their liquid balance
 * in yoctoNEAR. It answers `view_account` at final finality as a node does,
 * with `UNKNOWN_ACCOUNT` for an account that doesn't exist.
 */
function fakeNearRpc(accounts: Record<string, string>): typeof fetch {
  return async (url, init) => {
    const request = new Request(url, init);
    if (request.url !== NEAR_RPC_URL) throw new Error(`Unexpected request to ${request.url}`);
    const { id, method, params } = (await request.json()) as {
      id: unknown;
      method: string;
      params: Record<string, string>;
    };
    const answer = (body: object) => Response.json({ jsonrpc: "2.0", id, ...body });
    if (
      method !== "query" ||
      params.request_type !== "view_account" ||
      params.finality !== "final"
    ) {
      return answer({ error: { name: "HANDLER_ERROR", code: -32000, message: "Server error" } });
    }
    const amount = accounts[params.account_id ?? ""];
    if (amount === undefined) {
      return answer({
        error: {
          name: "HANDLER_ERROR",
          cause: { name: "UNKNOWN_ACCOUNT", info: { requested_account_id: params.account_id } },
          code: -32000,
          message: "Server error",
          data: `account ${params.account_id} does not exist while viewing`,
        },
      });
    }
    return answer({
      result: {
        amount,
        locked: "0",
        code_hash: "11111111111111111111111111111111",
        storage_usage: 182,
        storage_paid_at: 0,
        block_height: 1,
        block_hash: "h",
      },
    });
  };
}

describe("rpcNativeBalanceReader on NEAR", () => {
  const nearTestnet = () => {
    const network = findNetwork("near:testnet");
    if (!network) throw new Error("near:testnet isn't listed");
    return network;
  };

  test("reads the relayer's NEAR balance with view_account", async () => {
    const read = rpcNativeBalanceReader(
      { "near:testnet": NEAR_RPC_URL },
      fakeNearRpc({ [NEAR_RELAYER]: "2500000000000000000000000", ["other.testnet"]: "1" }),
    );

    expect(await read({ network: nearTestnet(), owner: NEAR_RELAYER })).toBe(
      "2500000000000000000000000",
    );
  });

  test("reads 0 for a relayer account that doesn't exist yet", async () => {
    const read = rpcNativeBalanceReader({ "near:testnet": NEAR_RPC_URL }, fakeNearRpc({}));

    expect(await read({ network: nearTestnet(), owner: NEAR_RELAYER })).toBe("0");
  });

  test("fails without naming the endpoint when the node can't answer", async () => {
    const down: typeof fetch = async () => new Response("Bad gateway", { status: 502 });
    // A runtime's own error can name the URL.
    const unreachable: typeof fetch = async () => {
      throw new TypeError(`fetch failed: ${NEAR_RPC_URL}`);
    };

    for (const fetchFn of [down, unreachable]) {
      const read = rpcNativeBalanceReader({ "near:testnet": NEAR_RPC_URL }, fetchFn);
      const failure = await read({ network: nearTestnet(), owner: NEAR_RELAYER }).then(
        () => expect.unreachable("the read should fail"),
        (error: unknown) => String(error),
      );
      expect(failure).toContain("NEAR Testnet");
      expect(failure).not.toContain("secret-api-key");
    }
  });
});
