import { createApp } from "./app.ts";
import { scheduled } from "./scheduled.ts";

export { EvmChainQueue } from "./evm-chain-queue.ts";
export { NearChainQueue } from "./near-chain-queue.ts";
export { SolanaChainQueue } from "./solana-chain-queue.ts";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<CloudflareBindings>;
