import { describe, expect, test } from "vite-plus/test";
import { environmentFromCloudflareEnv } from "./index.ts";

describe("environmentFromCloudflareEnv", () => {
  test("production is mainnet", () => {
    expect(environmentFromCloudflareEnv("production")).toBe("mainnet");
  });

  test("testnet is testnet", () => {
    expect(environmentFromCloudflareEnv("testnet")).toBe("testnet");
  });

  test("unset (local dev and tests) is testnet", () => {
    expect(environmentFromCloudflareEnv(undefined)).toBe("testnet");
    expect(environmentFromCloudflareEnv("")).toBe("testnet");
  });

  test("rejects an unknown Wrangler environment instead of guessing", () => {
    expect(() => environmentFromCloudflareEnv("mainnet")).toThrow(/CLOUDFLARE_ENV/);
    expect(() => environmentFromCloudflareEnv("prod")).toThrow(/CLOUDFLARE_ENV/);
  });
});
