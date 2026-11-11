import type {
  SolanaChainQueueRpc,
  SolanaSweepQueue,
  SolanaTokenAccountQueue,
} from "@herald/core/server";
import type { Caip2 } from "@herald/core";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// Sign-in waits on the hand-over. Past this, it counts as failed and the
// next sign-in hands the token account over again (the queue ignores a job
// it already has).
const QUEUE_TIMEOUT_MS = 5_000;

// A Sweep submission waits its turn behind the network's other
// transactions, then the node simulates and takes it. Past this, it counts
// as unanswered and the next refresh submits again (the queue answers the
// same signature for the same transaction).
const SUBMIT_TIMEOUT_MS = 30_000;

/**
 * The Solana chain queue for a network, over the `SOLANA_CHAIN_QUEUE`
 * cross-Worker Durable Object binding.
 *
 * The bound class lives in another Worker, so `wrangler types` types the
 * binding without its methods. The stub is typed with `SolanaChainQueueRpc`
 * from core, which the facilitator's `SolanaChainQueue` implements.
 */
function queueFor(network: Caip2) {
  return env.SOLANA_CHAIN_QUEUE.getByName(network) as DurableObjectStub & SolanaChainQueueRpc;
}

/** `call`'s answer, or a rejection once `ms` pass without one. */
async function withTimeout<T>(call: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} didn't answer in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hands a Provider's Solana USDC token account to the facilitator's Solana
 * chain queue for that network. Server only.
 */
export const solanaTokenAccountQueue = createServerOnlyFn((): SolanaTokenAccountQueue => {
  return async (job) => {
    const queued = await withTimeout(
      queueFor(job.network).queueTokenAccount(job),
      QUEUE_TIMEOUT_MS,
      "The Solana chain queue",
    );
    if (!queued.ok) throw new Error(queued.message);
  };
});

/**
 * Solana Sweeps through the facilitator's Solana chain queue: its fee
 * payer, and submitting signed Sweeps for it to co-sign and send. Server
 * only.
 */
export const solanaSweepQueue = createServerOnlyFn((): SolanaSweepQueue => ({
  feePayer: (network) =>
    withTimeout(queueFor(network).feePayer(), QUEUE_TIMEOUT_MS, "The Solana chain queue"),
  submitSweep: (submission) =>
    withTimeout(
      queueFor(submission.network).submitSweep(submission),
      SUBMIT_TIMEOUT_MS,
      "The Solana chain queue",
    ),
}));
