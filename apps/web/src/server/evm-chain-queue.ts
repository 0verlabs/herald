import type { Caip2 } from "@herald/core";
import type { EvmChainQueueRpc, EvmSweepSubmitter } from "@herald/core/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// A submission waits its turn behind the network's other transactions and
// makes a few RPC calls. Past this, it counts as unanswered and the next
// refresh submits again (the queue answers the same hash for the same
// authorization).
const SUBMIT_TIMEOUT_MS = 30_000;

/**
 * Herald's EVM gas wallet, as the facilitator's EVM chain queue for
 * `network` names it. Server only.
 */
export const evmGasWallet = createServerOnlyFn((network: Caip2): Promise<string> => {
  const queue = env.EVM_CHAIN_QUEUE.getByName(network) as DurableObjectStub & EvmChainQueueRpc;
  return queue.gasWallet();
});

/**
 * Submits a Sweep's signed transfer through the facilitator's EVM chain
 * queue for its network, over the `EVM_CHAIN_QUEUE` cross-Worker Durable
 * Object binding. Server only.
 *
 * The bound class lives in another Worker, so `wrangler types` types the
 * binding without its methods. The stub is typed with `EvmChainQueueRpc`
 * from core, which the facilitator's `EvmChainQueue` implements.
 */
export const evmSweepSubmitter = createServerOnlyFn((): EvmSweepSubmitter => {
  return async (submission) => {
    const queue = env.EVM_CHAIN_QUEUE.getByName(submission.network) as DurableObjectStub &
      EvmChainQueueRpc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`The EVM chain queue didn't answer in ${SUBMIT_TIMEOUT_MS} ms`)),
        SUBMIT_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([queue.submitSweep(submission), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
});
