import { ProviderSchema } from "@herald/core";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { createDb, providers } from "../src/index.ts";

const provider = {
  accountId: "herald-test.near",
  evmAddress: "0xf437261ba00ac4f34effb54d54df13a81b220e13",
  solanaAddress: "H396yYAeSpsgC6pQ7Qd681g9MSTT7oYZ4bCqGHGdbNiq",
};

describe("providers table", () => {
  test("stores a Provider that reads back as a valid core Provider", async () => {
    const db = createDb(env.DB);
    await db.insert(providers).values(provider);

    const [row] = await db
      .select()
      .from(providers)
      .where(eq(providers.accountId, provider.accountId));

    expect(ProviderSchema.parse(row)).toMatchObject(provider);
  });

  test("allows one row per Provider Account", async () => {
    const db = createDb(env.DB);
    const sameAccount = { ...provider, accountId: "unique-check.near" };
    await db.insert(providers).values(sameAccount);

    await expect(db.insert(providers).values(sameAccount)).rejects.toThrow();
  });
});
