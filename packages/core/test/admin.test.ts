import { createDb } from "@herald/db";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import {
  endSession,
  listSweepMinimums,
  readAdminSession,
  registerProvider,
  startSession,
  updateSweepMinimum,
} from "../src/server/index.ts";

const db = () => createDb(env.DB);

const AVALANCHE = "eip155:43114";
const AVALANCHE_USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const POLYGON = "eip155:137";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

async function signedIn(accountId: string) {
  const provider = await registerProvider(createDb(env.DB), { accountId, env: "mainnet" });
  return startSession(env.SESSIONS, provider);
}

describe("readAdminSession", () => {
  test("answers the session of a signed-in account on the allowlist", async () => {
    const { token, session } = await signedIn("admin-listed.near");

    expect(
      await readAdminSession(env.SESSIONS, token, { admins: "ops.near, admin-listed.near" }),
    ).toEqual(session);
  });

  test("refuses a signed-in account that isn't on the allowlist", async () => {
    const { token } = await signedIn("admin-unlisted.near");

    expect(await readAdminSession(env.SESSIONS, token, { admins: "ops.near" })).toBeNull();
  });

  test("refuses a visitor without a session, and an ended session", async () => {
    const { token } = await signedIn("admin-ended.near");
    await endSession(env.SESSIONS, token);

    expect(
      await readAdminSession(env.SESSIONS, undefined, { admins: "admin-ended.near" }),
    ).toBeNull();
    expect(await readAdminSession(env.SESSIONS, token, { admins: "admin-ended.near" })).toBeNull();
  });

  test("refuses everyone when no allowlist is set", async () => {
    const { token } = await signedIn("admin-none.near");

    expect(await readAdminSession(env.SESSIONS, token, { admins: undefined })).toBeNull();
    expect(await readAdminSession(env.SESSIONS, token, { admins: "" })).toBeNull();
  });

  test("refuses everyone when the allowlist holds something that isn't a NEAR account id", async () => {
    const { token } = await signedIn("admin-typo.near");

    expect(
      await readAdminSession(env.SESSIONS, token, { admins: "admin-typo.near; Ops.near" }),
    ).toBeNull();
  });
});

describe("listSweepMinimums", () => {
  test("lists the environment's minimums in Payment Option order, from the seeded table", async () => {
    const testnet = await listSweepMinimums(db(), { env: "testnet" });

    expect(testnet).toMatchObject([
      { network: "eip155:84532", label: "Base Sepolia", minimum: "150000" },
      { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", label: "Solana Devnet" },
      { network: "eip155:421614", label: "Arbitrum Sepolia", minimum: "1000" },
    ]);
    expect(testnet[0]?.note).toContain("mirrors Base mainnet");
    expect((await listSweepMinimums(db(), { env: "mainnet" })).map((m) => m.label)).toEqual([
      "Base",
      "Solana",
      "Arbitrum",
      "Polygon",
      "Avalanche",
    ]);
  });
});

describe("updateSweepMinimum", () => {
  test("sets a row's minimum, from a USDC amount, and its note, and timestamps the edit", async () => {
    const before = Date.now();

    const result = await updateSweepMinimum(db(), {
      env: "mainnet",
      edit: {
        network: AVALANCHE,
        asset: AVALANCHE_USDC,
        minimum: "0.25",
        note: "  1Click raised Avalanche's minimum (checked by ops).  ",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      minimum: {
        network: AVALANCHE,
        label: "Avalanche",
        minimum: "250000",
        note: "1Click raised Avalanche's minimum (checked by ops).",
      },
    });
    const listed = (await listSweepMinimums(db(), { env: "mainnet" })).find(
      (m) => m.network === AVALANCHE,
    );
    expect(listed).toMatchObject({ minimum: "250000", note: result.ok && result.minimum.note });
    expect(listed?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("rejects an edit that doesn't validate and leaves the row as it was", async () => {
    const edit = { network: POLYGON, asset: POLYGON_USDC, minimum: "0.5", note: "Fine." };
    const rejected = await Promise.all(
      [
        { ...edit, minimum: "0.0000001" },
        { ...edit, minimum: "0" },
        { ...edit, minimum: "-1" },
        { ...edit, minimum: "ten" },
        { ...edit, note: "   " },
        { ...edit, note: "x".repeat(501) },
      ].map((bad) => updateSweepMinimum(db(), { env: "mainnet", edit: bad })),
    );

    for (const result of rejected) expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(rejected[0]?.ok === false && rejected[0].message).toContain("6 decimal places");
    expect(
      (await listSweepMinimums(db(), { env: "mainnet" })).find((m) => m.network === POLYGON),
    ).toMatchObject({ minimum: "1000", note: expect.stringContaining("1Click minimum deposit") });
  });

  test("rejects a row outside the environment, or one Herald has no minimum for", async () => {
    const outside = await updateSweepMinimum(db(), {
      env: "testnet",
      edit: { network: AVALANCHE, asset: AVALANCHE_USDC, minimum: "1", note: "Not here." },
    });
    const wrongAsset = await updateSweepMinimum(db(), {
      env: "mainnet",
      edit: { network: AVALANCHE, asset: POLYGON_USDC, minimum: "1", note: "Not USDC here." },
    });

    expect(outside).toMatchObject({ ok: false, reason: "not_found" });
    expect(wrongAsset).toMatchObject({ ok: false, reason: "not_found" });
  });
});
