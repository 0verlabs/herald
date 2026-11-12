import type { Caip2 } from "@herald/core";
import type { NearChainQueueRpc, NearSetupQueue } from "@herald/core/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// Sign-in waits on the hand-over. Past this, it counts as failed and the
// next sign-in hands the setup over again (the queue ignores a job it
// already has).
const QUEUE_TIMEOUT_MS = 5_000;

/**
 * The NEAR chain queue for a network, over the `NEAR_CHAIN_QUEUE`
 * cross-Worker Durable Object binding.
 *
 * The bound class lives in another Worker, so `wrangler types` types the
 * binding without its methods. The stub is typed with `NearChainQueueRpc`
 * from core, which the facilitator's `NearChainQueue` implements.
 */
function queueFor(network: Caip2) {
  return env.NEAR_CHAIN_QUEUE.getByName(network) as DurableObjectStub & NearChainQueueRpc;
}

/**
 * Herald's NEAR relayer, which pays NEAR gas, as the facilitator's NEAR
 * chain queue for `network` names it. Server only.
 */
export const nearRelayer = createServerOnlyFn((network: Caip2): Promise<string> =>
  queueFor(network).relayer(),
);

/**
 * Hands a Provider's NEAR Receiving Address setup to the facilitator's NEAR
 * chain queue for that network. Server only.
 */
export const nearSetupQueue = createServerOnlyFn((): NearSetupQueue => {
  return async (job) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The NEAR chain queue didn't answer in ${QUEUE_TIMEOUT_MS} ms`)),
        QUEUE_TIMEOUT_MS,
      );
    });
    try {
      const queued = await Promise.race([queueFor(job.network).queueSetup(job), timeout]);
      if (!queued.ok) throw new Error(queued.message);
    } finally {
      clearTimeout(timer);
    }
  };
});
