import { describe, expect, test } from "vite-plus/test";
import { accepts, facilitatorUrls } from "./index.ts";

// Receiving Addresses recorded from the live mainnet `v1.signer` contract
// (`derived_public_key`) for `herald-test.near` (see #1). Not from the docs,
// whose sample addresses don't match the live contract.
const mainnetEvm = "0xf437261ba00ac4f34effb54d54df13a81b220e13";
const mainnetSolana = "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq";

describe("accepts() on mainnet", () => {
  test("pays every chain into the Provider Account's Receiving Addresses", () => {
    const options = accepts({ providerAccount: "herald-test.near", price: "$0.01" });

    expect(options.map((o) => [o.network, o.payTo])).toEqual([
      ["eip155:8453", mainnetEvm],
      ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", mainnetSolana],
      ["eip155:42161", mainnetEvm],
      ["eip155:137", mainnetEvm],
      ["eip155:43114", mainnetEvm],
    ]);
  });

  test("prices every chain in USDC with an explicit asset, amount and EIP-712 domain", () => {
    const [base, solana, arbitrum, polygon, avalanche] = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
    });

    expect(base).toEqual({
      scheme: "exact",
      network: "eip155:8453",
      payTo: mainnetEvm,
      price: {
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "10000",
        extra: { name: "USD Coin", version: "2" },
      },
      maxTimeoutSeconds: 300,
    });
    expect(solana).toEqual({
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      payTo: mainnetSolana,
      price: { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "10000" },
      maxTimeoutSeconds: 300,
    });
    expect([arbitrum, polygon, avalanche].map((o) => o?.price)).toEqual([
      {
        asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        amount: "10000",
        extra: { name: "USD Coin", version: "2" },
      },
      {
        asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        amount: "10000",
        extra: { name: "USD Coin", version: "2" },
      },
      {
        asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        amount: "10000",
        extra: { name: "USD Coin", version: "2" },
      },
    ]);
  });
});

// Recorded from the live `v1.signer-prod.testnet` contract
// (`derived_public_key`) for `herald-test.near`, 2026-11-10.
const testnetEvm = "0xddd22895f299b4aed54ebd6468a273e857d83296";
const testnetSolana = "6hNg2qo9BhiG87haavYeqTEjqA4GgWZbAhEKihUqumPL";

describe("accepts() on testnet", () => {
  test("offers Base Sepolia, Solana devnet and Arbitrum Sepolia, without Polygon or Avalanche", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      network: "testnet",
    });

    expect(options).toEqual([
      {
        scheme: "exact",
        network: "eip155:84532",
        payTo: testnetEvm,
        price: {
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "10000",
          // Base Sepolia's USDC names its EIP-712 domain "USDC", unlike mainnet.
          extra: { name: "USDC", version: "2" },
        },
        maxTimeoutSeconds: 300,
      },
      {
        scheme: "exact",
        network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        payTo: testnetSolana,
        price: { asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", amount: "10000" },
        maxTimeoutSeconds: 300,
      },
      {
        scheme: "exact",
        network: "eip155:421614",
        payTo: testnetEvm,
        price: {
          asset: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
          amount: "10000",
          extra: { name: "USD Coin", version: "2" },
        },
        maxTimeoutSeconds: 300,
      },
    ]);
  });

  test("defaults to mainnet", () => {
    expect(accepts({ providerAccount: "herald-test.near", price: "$0.01" })).toEqual(
      accepts({ providerAccount: "herald-test.near", price: "$0.01", network: "mainnet" }),
    );
  });
});

describe("accepts() chains filter", () => {
  test("keeps only the listed chains, in registry order whatever the list's order", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      chains: ["avalanche", "solana", "base"],
    });

    expect(options.map((o) => o.network)).toEqual([
      "eip155:8453",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "eip155:43114",
    ]);
  });

  test("skips chains the network doesn't list, so one config works on both networks", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      network: "testnet",
      chains: ["polygon", "arbitrum"],
    });

    expect(options.map((o) => o.network)).toEqual(["eip155:421614"]);
  });

  test("rejects a filter that leaves no Payment Option", () => {
    expect(() =>
      accepts({
        providerAccount: "herald-test.near",
        price: "$0.01",
        network: "testnet",
        chains: ["polygon", "avalanche"],
      }),
    ).toThrow("none of polygon, avalanche is listed on testnet");
    expect(() =>
      accepts({ providerAccount: "herald-test.near", price: "$0.01", chains: [] }),
    ).toThrow("chains must list at least one chain");
  });

  test("rejects an unknown chain name", () => {
    expect(() =>
      accepts({
        providerAccount: "herald-test.near",
        price: "$0.01",
        // @ts-expect-error: Optimism is not a Herald chain.
        chains: ["base", "optimism"],
      }),
    ).toThrow(/chains\[1\].*"base", "solana", "arbitrum", "polygon", "avalanche"/);
  });
});

describe("accepts() input checks", () => {
  test.each(["Alice.near", "alice..near", "a", "-alice.near", "alice near", ""])(
    "rejects the account id %j",
    (providerAccount) => {
      expect(() => accepts({ providerAccount, price: "$0.01" })).toThrow(
        /^accepts\(\): providerAccount: Invalid NEAR account id/,
      );
    },
  );

  test.each([
    ["0.01$", "must be a USD amount like"],
    ["$-1", "must be a USD amount like"],
    ["$abc", "must be a USD amount like"],
    ["", "must be a USD amount like"],
    ["$1,000", "must be a USD amount like"],
    ["$.5", "must be a USD amount like"],
    ["$1e-3", "must be a USD amount like"],
    ["$0.0000001", "more than 6 decimal places"],
    ["$0", "must be more than $0"],
    ["$0.000000", "must be more than $0"],
  ])("rejects the price %j", (price, message) => {
    expect(() => accepts({ providerAccount: "herald-test.near", price })).toThrow(
      new RegExp(`^accepts\\(\\): price: .*${message.replace(/[$.]/g, "\\$&")}`),
    );
  });

  test("rejects a numeric price", () => {
    // @ts-expect-error: price is a USD string, as in the stock x402 route config.
    expect(() => accepts({ providerAccount: "herald-test.near", price: 0.01 })).toThrow(
      /^accepts\(\): price: /,
    );
  });

  test("rejects an unknown network", () => {
    expect(() =>
      // @ts-expect-error: devnet is a Solana cluster, not a Herald network.
      accepts({ providerAccount: "herald-test.near", price: "$0.01", network: "devnet" }),
    ).toThrow(/^accepts\(\): network: /);
  });
});

describe("facilitatorUrls", () => {
  // The workers.dev URLs of the facilitator Workers named in
  // apps/facilitator/wrangler.jsonc.
  test("points each network at its Herald facilitator", () => {
    expect(facilitatorUrls).toEqual({
      mainnet: "https://herald-facilitator-mainnet.luckzivanius.workers.dev",
      testnet: "https://herald-facilitator-testnet.luckzivanius.workers.dev",
    });
  });
});

describe("accepts() price", () => {
  // USDC has 6 decimals and is treated as exactly $1.
  test.each([
    ["$0.01", "10000"],
    ["$0.001", "1000"],
    ["$0.000001", "1"],
    ["$1", "1000000"],
    ["$12.5", "12500000"],
    ["$1000.123456", "1000123456"],
    ["0.25", "250000"],
  ])("%s is %s USDC base units", (price, amount) => {
    const [base] = accepts({ providerAccount: "herald-test.near", price });
    expect(base?.price.amount).toBe(amount);
  });
});
