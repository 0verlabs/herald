// Registers a Provider and issues it a testnet API key, through the same
// core functions the dashboard will use. For local runs and the testnet
// deployment only; mainnet keys come from the dashboard.
//
//   node scripts/seed.ts <provider-account>                 # local D1 (.wrangler/state)
//   node scripts/seed.ts <provider-account> --env testnet   # herald-testnet D1
//
// Apply migrations first (`vp run db:migrate:local` or `db:migrate:testnet`).
// The key is printed once; Herald stores only its hash.
import { parseArgs } from "node:util";
import { issueApiKey, registerProvider } from "@herald/core/server";
import { createDb } from "@herald/db";
import { getPlatformProxy } from "wrangler";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { env: { type: "string", default: "local" } },
});
const [accountId] = positionals;
if (!accountId || !["local", "testnet"].includes(values.env)) {
  console.error("Usage: node scripts/seed.ts <provider-account> [--env local|testnet]");
  process.exit(1);
}

const local = values.env === "local";
const proxy = await getPlatformProxy<CloudflareBindings>({
  configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
  ...(local
    ? { persist: { path: new URL("../../../.wrangler/state/v3", import.meta.url).pathname } }
    : { environment: "testnet" }),
});
try {
  const db = createDb(proxy.env.DB);
  const provider = await registerProvider(db, { accountId, env: "testnet" });
  const { apiKey, secret } = await issueApiKey(db, { providerId: provider.id, env: "testnet" });
  console.log(
    [
      `Provider ${provider.accountId} (id ${provider.id}) on ${values.env}`,
      `  EVM Receiving Address:    ${provider.evmAddress}`,
      `  Solana Receiving Address: ${provider.solanaAddress}`,
      `API key ${apiKey.prefix}… (id ${apiKey.id}), shown once:`,
      `  ${secret}`,
    ].join("\n"),
  );
} finally {
  await proxy.dispose();
}
