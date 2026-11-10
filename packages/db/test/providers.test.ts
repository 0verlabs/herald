import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { createDb, providers } from "../src/index.ts";

// Core parses the rows it reads with its Zod schemas (core depends on this
// package, so these tests can't import core without a cycle).
const provider = {
  accountId: "herald-test.near",
  evmAddress: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
  solanaAddress: "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq",
};

describe("providers table", () => {
  test("stores a Provider and reads it back with its creation time", async () => {
    const db = createDb(env.DB);
    await db.insert(providers).values(provider);

    const [row] = await db
      .select()
      .from(providers)
      .where(eq(providers.accountId, provider.accountId));

    expect(row).toMatchObject(provider);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  test("allows one row per Provider Account", async () => {
    const db = createDb(env.DB);
    const duplicateProvider = { ...provider, accountId: "unique-check.near" };
    await db.insert(providers).values(duplicateProvider);

    await expect(db.insert(providers).values(duplicateProvider)).rejects.toThrow();
  });
});
