import type { Caip2 } from "@herald/core";
import type { NearChainQueueRpc } from "@herald/core/server";
import { createServerOnlyFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

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
