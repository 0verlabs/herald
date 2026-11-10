import type { SolanaChainQueueRpc, SolanaTokenAccountQueue } from "@herald/core/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// Sign-in waits on the hand-over. Past this, it counts as failed and the
// next sign-in hands the token account over again (the queue ignores a job
// it already has).
const QUEUE_TIMEOUT_MS = 5_000;

/**
 * Hands a Provider's Solana USDC token account to the facilitator's Solana
 * chain queue for that network, over the `SOLANA_CHAIN_QUEUE` cross-Worker
 * Durable Object binding. Server only.
 *
 * The bound class lives in another Worker, so `wrangler types` types the
 * binding without its methods. The stub is typed with `SolanaChainQueueRpc`
 * from core, which the facilitator's `SolanaChainQueue` implements.
 */
export const solanaTokenAccountQueue = createServerOnlyFn((): SolanaTokenAccountQueue => {
  return async (job) => {
    const queue = env.SOLANA_CHAIN_QUEUE.getByName(job.network) as DurableObjectStub &
      SolanaChainQueueRpc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The Solana chain queue didn't answer in ${QUEUE_TIMEOUT_MS} ms`)),
        QUEUE_TIMEOUT_MS,
      );
    });
    try {
      const queued = await Promise.race([queue.queueTokenAccount(job), timeout]);
      if (!queued.ok) throw new Error(queued.message);
    } finally {
      clearTimeout(timer);
    }
  };
});
