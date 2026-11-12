// Registers a Provider and issues it a testnet API key, through the same
// core functions the dashboard will use. For local runs and the testnet
// deployment only; mainnet keys come from the dashboard.
//
//   node scripts/seed.ts <provider-account>                 # local D1 (.wrangler/state)
//   node scripts/seed.ts <provider-account> --env testnet   # herald-testnet D1
//
// Apply migrations first (`vp run db:migrate:local` or `db:migrate:testnet`).
// The key is printed once; Herald stores only its hash.
//
// Locally it also queues the Provider's Solana USDC token account, as the
// dashboard's first sign-in does, through the web Worker's cross-Worker
// binding to the Solana chain queue. Run the facilitator (`vp run dev`)
// first. On testnet the token account is queued at the Provider's first
// dashboard sign-in.
import { parseArgs } from "node:util";
import {
  ensureSolanaTokenAccountQueued,
  issueApiKey,
  registerProvider,
  type SolanaChainQueueRpc,
} from "@herald/core/server";
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
const persist = { path: new URL("../../../.wrangler/state/v3", import.meta.url).pathname };
const proxy = await getPlatformProxy<CloudflareBindings>({
  configPath: new URL("../wrangler.jsonc", import.meta.url).pathname,
  ...(local ? { persist } : { environment: "testnet" }),
});
const web = local
  ? await getPlatformProxy<{ SOLANA_CHAIN_QUEUE: DurableObjectNamespace }>({
      configPath: new URL("../../web/wrangler.jsonc", import.meta.url).pathname,
      persist,
    })
  : undefined;
try {
  const db = createDb(proxy.env.DB);
  let provider = await registerProvider(db, { accountId, env: "testnet" });
  if (web) {
    provider = await ensureSolanaTokenAccountQueued(
      {
        db,
        queueSolanaTokenAccount: async (job) => {
          const queue = web.env.SOLANA_CHAIN_QUEUE.getByName(job.network) as DurableObjectStub &
            SolanaChainQueueRpc;
          // The platform proxy hands RPC results back as proxies; read the
          // fields one by one.
          const queued = await queue.queueTokenAccount(job);
          if (!(await Promise.resolve(queued.ok))) {
            throw new Error(String(await Promise.resolve(Reflect.get(queued, "message"))));
          }
        },
      },
      { provider, env: "testnet" },
    );
  }
  const { apiKey, secret } = await issueApiKey(db, { providerId: provider.id, env: "testnet" });
  console.log(
    [
      `Provider ${provider.accountId} (id ${provider.id}) on ${values.env}`,
      `  EVM Receiving Address:    ${provider.evmAddress}`,
      `  Solana Receiving Address: ${provider.solanaAddress}`,
      `  NEAR Receiving Address:   ${provider.nearAddress}`,
      `  Solana USDC token account: ${provider.solanaTokenAccountStatus}`,
      `API key ${apiKey.prefix}… (id ${apiKey.id}), shown once:`,
      `  ${secret}`,
    ].join("\n"),
  );
} finally {
  await web?.dispose();
  await proxy.dispose();
}
