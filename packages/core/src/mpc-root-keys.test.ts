import { describe, expect, test } from "vite-plus/test";
import { checkMpcRootKeys, nearRpcMpcRootKeyReader, type MpcRootKeyReader } from "./index.ts";

// Root keys as `public_key({ domain_id })` returned them on 2026-11-10.
const live: Record<string, Record<number, string>> = {
  "v1.signer": {
    0: "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
    1: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
  },
  "v1.signer-prod.testnet": {
    0: "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
    1: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
  },
};

const liveContract: MpcRootKeyReader = async ({ contractId, domainId }) => {
  const key = live[contractId]?.[domainId];
  if (!key) throw new Error(`no domain ${domainId} on ${contractId}`);
  return key;
};

describe("checkMpcRootKeys", () => {
  test.each(["mainnet", "testnet"] as const)(
    "passes when %s's contract has the pinned keys",
    async (network) => {
      expect(await checkMpcRootKeys(network, liveContract)).toEqual({ ok: true, mismatches: [] });
    },
  );

  test("reports each domain whose live key differs from the pinned one", async () => {
    const rotatedEd25519: MpcRootKeyReader = async (request) =>
      request.domainId === 1
        ? "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2"
        : liveContract(request);

    expect(await checkMpcRootKeys("mainnet", rotatedEd25519)).toEqual({
      ok: false,
      mismatches: [
        {
          contractId: "v1.signer",
          domainId: 1,
          pinned: "ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF",
          live: "ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2",
        },
      ],
    });
  });

  test("passes reader failures through, since an unchecked key is not a match", async () => {
    const down: MpcRootKeyReader = async () => {
      throw new Error("RPC unavailable");
    };

    await expect(checkMpcRootKeys("testnet", down)).rejects.toThrow("RPC unavailable");
  });
});

describe("nearRpcMpcRootKeyReader", () => {
  // The endpoint's URL carries its API key, and a runtime's error may name it.
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
    const read = nearRpcMpcRootKeyReader("https://near.example/api-key-1234", fetchFn);

    const error: unknown = await read({ contractId: "v1.signer", domainId: 0 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("api-key-1234");
  });
});
