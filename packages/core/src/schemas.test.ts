import { describe, expect, test } from "vite-plus/test";
import {
  NetworkSchema,
  EvmAddressSchema,
  NearAccountIdSchema,
  ProviderSchema,
  SolanaAddressSchema,
} from "./index.ts";

// Receiving Addresses recorded from mainnet for `herald-test.near` (see #1).
const evmAddress = "0xf437261ba00ac4f34effb54d54df13a81b220e13";
const solanaAddress = "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq";

describe("NetworkSchema", () => {
  // Herald networks, not CAIP-2 chain ids.
  test("accepts testnet and mainnet only", () => {
    expect(NetworkSchema.parse("testnet")).toBe("testnet");
    expect(NetworkSchema.parse("mainnet")).toBe("mainnet");
    expect(NetworkSchema.safeParse("devnet").success).toBe(false);
  });
});

describe("NearAccountIdSchema", () => {
  test.each(["herald-test.near", "alice.testnet", "a_b-c.d.near", "ab", "0verlabs.near"])(
    "accepts %s",
    (id) => {
      expect(NearAccountIdSchema.parse(id)).toBe(id);
    },
  );

  test.each([
    ["a", "too short"],
    ["x".repeat(65), "too long"],
    ["Alice.near", "uppercase"],
    ["alice..near", "empty segment"],
    ["-alice.near", "leading separator"],
    ["alice-.near", "trailing separator"],
    ["alice near", "whitespace"],
  ])("rejects %s (%s)", (id) => {
    expect(NearAccountIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("Receiving Address schemas", () => {
  test("accept the recorded mainnet vectors", () => {
    expect(EvmAddressSchema.parse(evmAddress)).toBe(evmAddress);
    expect(SolanaAddressSchema.parse(solanaAddress)).toBe(solanaAddress);
  });

  test("reject malformed addresses", () => {
    expect(EvmAddressSchema.safeParse("0x1234").success).toBe(false);
    expect(EvmAddressSchema.safeParse(solanaAddress).success).toBe(false);
    // Base58 has no 0, O, I or l.
    expect(SolanaAddressSchema.safeParse("0".repeat(44)).success).toBe(false);
    expect(SolanaAddressSchema.safeParse(evmAddress).success).toBe(false);
  });
});

describe("ProviderSchema", () => {
  test("parses a Provider with its Receiving Addresses", () => {
    const createdAt = new Date("2026-11-10T00:00:00Z");
    expect(
      ProviderSchema.parse({
        id: 1,
        accountId: "herald-test.near",
        evmAddress,
        solanaAddress,
        createdAt,
      }),
    ).toEqual({ id: 1, accountId: "herald-test.near", evmAddress, solanaAddress, createdAt });
  });

  test("rejects a Provider with an invalid account id", () => {
    const result = ProviderSchema.safeParse({
      id: 1,
      accountId: "Not A Near Account",
      evmAddress,
      solanaAddress,
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});
