import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { installFakeNetwork, nearRelayer } from "./support/network.ts";
import { facilitatorClient } from "./support/parties.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /supported", () => {
  test("lists every testnet network with the exact scheme, without an API key", async () => {
    installFakeNetwork();

    const supported = await facilitatorClient().getSupported();

    expect(
      supported.kinds.map(({ x402Version, scheme, network }) => [x402Version, scheme, network]),
    ).toEqual([
      [2, "exact", "near:testnet"],
      [2, "exact", "eip155:84532"],
      [2, "exact", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
      [2, "exact", "eip155:421614"],
    ]);
    // The stock Solana server reads Herald's fee payer from here.
    const solana = supported.kinds.find((kind) => kind.network.startsWith("solana:"));
    expect(solana?.extra?.feePayer).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  test("lists Herald's NEAR relayer, as the stock NEAR mechanism does", async () => {
    installFakeNetwork();

    const supported = await facilitatorClient().getSupported();

    expect(supported.signers["near:*"]).toEqual([nearRelayer().accountId]);
    expect(nearRelayer().accountId).toMatch(/^[0-9a-f]{64}$/);
    // NEAR needs nothing more in the requirements.
    expect(supported.kinds.find((kind) => kind.network === "near:testnet")?.extra).toBeUndefined();
  });
});
