import { queuePendingNearSetups, type NearSetupQueue } from "@herald/core/server";
import { createDb } from "@herald/db";
import { heraldEnvOf } from "./chains.ts";

// Providers whose NEAR setup one Cron Trigger run hands to the chain queue.
// Each takes a few D1 queries and one Durable Object call; the rest wait for
// the next run (`triggers.crons` in wrangler.jsonc, every 10 minutes).
const NEAR_SETUP_BATCH = 50;

/**
 * Hands a setup job to this Worker's own NEAR chain queue. Throws when the
 * queue refuses it, so the Provider stays `not_queued` for the next run.
 */
function nearSetupQueue(env: CloudflareBindings): NearSetupQueue {
  return async (job) => {
    const queued = await env.NEAR_CHAIN_QUEUE.getByName(job.network).queueSetup(job);
    if (!queued.ok) throw new Error(queued.message);
  };
}

/**
 * The facilitator's Cron Trigger. It queues the NEAR Receiving Address setup
 * of Providers that aren't on their way: those registered before NEAR who
 * don't sign in again, and those the chain queue gave up on, which go back
 * to `not_queued`. Sign-in queues it as well; queueing is idempotent.
 */
export async function scheduled(
  _controller: ScheduledController,
  env: CloudflareBindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const result = await queuePendingNearSetups(
    { db: createDb(env.DB), queueNearSetup: nearSetupQueue(env) },
    { env: heraldEnvOf(env), limit: NEAR_SETUP_BATCH },
  );
  if (result.queued + result.failed > 0) {
    console.log(JSON.stringify({ event: "near_setups_queued", ...result }));
  }
}
