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
// `derived_public_key` on path `near-1`, domain 1, as hex: an implicit
// account. Recorded from `v1.signer-prod.testnet`, 2026-11-12.
const testnetNear = "dd8a6fceebf4d64665a1f0ee59ebdc07ac150515abdcb85640fe6ecb0033b73e";

describe("accepts() on testnet", () => {
  test("offers NEAR Testnet first, then Base Sepolia, Solana devnet and Arbitrum Sepolia, without Polygon or Avalanche", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      env: "testnet",
    });

    expect(options).toEqual([
      {
        scheme: "exact",
        network: "near:testnet",
        payTo: testnetNear,
        // Circle's NEP-141 USDC, without an EIP-712 domain.
        price: {
          asset: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
          amount: "10000",
        },
        maxTimeoutSeconds: 300,
      },
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
      accepts({ providerAccount: "herald-test.near", price: "$0.01", env: "mainnet" }),
    );
  });
});

describe("accepts() networks filter", () => {
  test("keeps only the listed CAIP-2 networks, in registry order whatever the list's order", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      networks: ["eip155:43114", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:8453"],
    });

    expect(options.map((o) => o.network)).toEqual([
      "eip155:8453",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "eip155:43114",
    ]);
  });

  test("filters testnet by its own CAIP-2 ids", () => {
    const options = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      env: "testnet",
      networks: ["eip155:421614"],
    });

    expect(options.map((o) => o.network)).toEqual(["eip155:421614"]);
  });

  test("can include or exclude NEAR Testnet", () => {
    const only = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      env: "testnet",
      networks: ["eip155:84532", "near:testnet"],
    });
    const without = accepts({
      providerAccount: "herald-test.near",
      price: "$0.01",
      env: "testnet",
      networks: ["eip155:84532", "eip155:421614"],
    });

    expect(only.map((o) => [o.network, o.payTo])).toEqual([
      ["near:testnet", testnetNear],
      ["eip155:84532", testnetEvm],
    ]);
    expect(without.map((o) => o.network)).toEqual(["eip155:84532", "eip155:421614"]);
  });

  test("rejects a network Herald doesn't list in that environment", () => {
    // Polygon has no Herald testnet.
    expect(() =>
      accepts({
        providerAccount: "herald-test.near",
        price: "$0.01",
        env: "testnet",
        networks: ["eip155:421614", "eip155:137"],
      }),
    ).toThrow(
      "accepts(): eip155:137 is not a Herald network on testnet (testnet lists near:testnet, eip155:84532, solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1, eip155:421614)",
    );
    // A mainnet id on testnet is a mix-up, not something to skip.
    expect(() =>
      accepts({
        providerAccount: "herald-test.near",
        price: "$0.01",
        env: "testnet",
        networks: ["eip155:8453"],
      }),
    ).toThrow("eip155:8453 is not a Herald network on testnet");
    // Optimism is not a Herald network at all.
    expect(() =>
      accepts({ providerAccount: "herald-test.near", price: "$0.01", networks: ["eip155:10"] }),
    ).toThrow("eip155:10 is not a Herald network on mainnet");
  });

  test("rejects an empty list", () => {
    expect(() =>
      accepts({ providerAccount: "herald-test.near", price: "$0.01", networks: [] }),
    ).toThrow("accepts(): networks: must list at least one network");
  });

  test("rejects an id that isn't CAIP-2", () => {
    expect(() =>
      accepts({
        providerAccount: "herald-test.near",
        price: "$0.01",
        // @ts-expect-error: networks are CAIP-2 ids, not names.
        networks: ["eip155:8453", "base"],
      }),
    ).toThrow('accepts(): networks[1]: must be a CAIP-2 network id like "eip155:8453"');
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

  test("rejects an unknown Herald environment", () => {
    expect(() =>
      // @ts-expect-error: devnet is a Solana cluster, not a Herald environment.
      accepts({ providerAccount: "herald-test.near", price: "$0.01", env: "devnet" }),
    ).toThrow(/^accepts\(\): env: /);
  });
});

describe("facilitatorUrls", () => {
  // The custom domains of the facilitator Workers named in
  // apps/facilitator/wrangler.jsonc.
  test("points each network at its Herald facilitator", () => {
    expect(facilitatorUrls).toEqual({
      mainnet: "https://facilitator.herald.0verlabs.com",
      testnet: "https://facilitator.herald-testnet.0verlabs.com",
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
