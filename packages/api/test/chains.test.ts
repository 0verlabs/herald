import { describe, expect, it } from "vitest";

import { chains, requireUsdc } from "../src/lib/chains";
import { callableChainSlugs, chainSchema, chainSlugs } from "../src/types/chain";

// `chains` is checked against `EvmChainConfig` at compile time, but `chainSchema` carries the
// runtime constraints the type cannot express — CAIP-2 shape, non-empty token addresses,
// non-negative decimals — so this is the only thing standing between a typo in the registry and
// a malformed on-chain call.
describe("chain registry", () => {
  it.each(Object.entries(chains))("%s passes the chain schema", (_slug, config) => {
    expect(() => chainSchema.parse(config)).not.toThrow();
  });
});

describe("chainSchema", () => {
  // A Chain identifier is not an EVM concept. If this ever narrows to `eip155:`, adding a
  // non-EVM chain means changing the schema rather than adding a registry entry.
  it("accepts a non-EVM CAIP-2 namespace", () => {
    expect(
      chainSchema.safeParse({ ...chains["0g-testnet"], caip2: "solana:4sGjMW1sUnHzSxGspuhpqLDx" })
        .success
    ).toBe(true);
  });

  it.each([
    "16602",
    "eip155:",
    ":16602",
    "eip155:not-a-ref!",
  ])("rejects the malformed chain identifier %s", (caip2) => {
    expect(chainSchema.safeParse({ ...chains["0g-testnet"], caip2 }).success).toBe(false);
  });

  it("rejects a token with an empty address", () => {
    const config = chains["0g"];
    expect(
      chainSchema.safeParse({
        ...config,
        tokens: { ...config.tokens, usdc: { ...config.tokens.usdc, address: "" } },
      }).success
    ).toBe(false);
  });
});

describe("callableChainSlugs", () => {
  it("excludes mainnet, so no tool can move real funds", () => {
    expect(callableChainSlugs).not.toContain("0g");
  });

  it("is a subset of the registry", () => {
    expect(chainSlugs).toEqual(expect.arrayContaining([...callableChainSlugs]));
  });
});

describe("requireUsdc", () => {
  it("returns the deployment where there is one", () => {
    expect(requireUsdc("0g").address).toBe("0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E");
  });

  it("throws rather than resolve a chain with no USDC deployment", () => {
    expect(() => requireUsdc("0g-testnet")).toThrow(/not deployed/);
  });
});

describe("txUrl", () => {
  it("builds a transaction link on the chain's own explorer", () => {
    expect(chains["0g-testnet"].txUrl("0xabc")).toBe("https://chainscan-galileo.0g.ai/tx/0xabc");
  });

  it("points each chain at a different explorer", () => {
    expect(chains["0g"].txUrl("0xabc")).not.toBe(chains["0g-testnet"].txUrl("0xabc"));
  });
});
