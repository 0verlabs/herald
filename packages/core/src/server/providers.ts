import { providers } from "@herald/db/schema";
import { and, asc, eq, isNull, ne, or } from "drizzle-orm";
import { networkRegistry, type Caip2, type Network } from "../networks.ts";
import { deriveReceivingAddresses } from "../receiving-addresses.ts";
import {
  NearAccountIdSchema,
  ProviderSchema,
  type HeraldEnv,
  type NearAccountId,
  type NearSetupStatus,
  type Provider,
  type SolanaAddress,
  type SolanaTokenAccountStatus,
} from "../schemas.ts";
import type { Db } from "./db.ts";
import type { NearSetupJob } from "./near-chain-queue.ts";
import type { SolanaSweepSubmission, SolanaSweepSubmissionResult } from "./solana-sweeps.ts";

/**
 * Creating one Provider's USDC token account on a Solana network: the token
 * account of `owner`, its Solana Receiving Address.
 */
export type SolanaTokenAccountJob = { network: Caip2; providerId: number; owner: SolanaAddress };

/**
 * Hands a token account to Herald's Solana chain queue (the
 * `SolanaChainQueue` Durable Object in `apps/facilitator`), which creates it
 * at most once, paying the rent, and reports back through
 * `setSolanaTokenAccountStatus`. Resolves once the queue has the job.
 */
export type SolanaTokenAccountQueue = (job: SolanaTokenAccountJob) => Promise<void>;

/**
 * The RPC interface the `SolanaChainQueue` Durable Object offers other
 * Workers through a cross-Worker Durable Object binding, one object per
 * Solana network, named by its CAIP-2 id.
 */
export interface SolanaChainQueueRpc {
  /**
   * Idempotent: a job it already has is ignored, and an account it created
   * is reported as `created` again. Refuses (`ok: false`) a job it can't
   * take, such as one for another network.
   */
  queueTokenAccount(
    job: SolanaTokenAccountJob,
  ): Promise<{ ok: true } | { ok: false; message: string }>;

  /** The gas wallet's address: the fee payer of every Solana Sweep. */
  feePayer(): Promise<string>;

  /** `SolanaSweepQueue.submitSweep` for the queue's network. */
  submitSweep(submission: SolanaSweepSubmission): Promise<SolanaSweepSubmissionResult>;
}

/**
 * Makes sure a Provider's Solana USDC token account is on its way: unless it
 * is `created`, hands it to the Solana chain queue and marks it `queued`.
 * The chain queue ignores a job it already has and creates each account at
 * most once, so handing it over again is safe, and it recovers a job the
 * queue never received. If the chain queue can't be reached, the Provider
 * goes back to `not_queued` for the next call to retry, and the failure is
 * logged. Returns the Provider as it now stands.
 */
export async function ensureSolanaTokenAccountQueued(
  deps: { db: Db; queueSolanaTokenAccount: SolanaTokenAccountQueue },
  input: { provider: Provider; env: HeraldEnv },
): Promise<Provider> {
  const { db } = deps;
  const { provider } = input;
  const network = networkRegistry[input.env].find((n) => n.kind === "solana");
  if (!network || provider.solanaTokenAccountStatus === "created") return provider;
  const notCreated = and(
    eq(providers.id, provider.id),
    ne(providers.solanaTokenAccountStatus, "created"),
  );
  await db.update(providers).set({ solanaTokenAccountStatus: "queued" }).where(notCreated);
  try {
    await deps.queueSolanaTokenAccount({
      network: network.caip2,
      providerId: provider.id,
      owner: provider.solanaAddress,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "solana_token_account_queue_failed",
        providerId: provider.id,
        error: String(error),
      }),
    );
    await db.update(providers).set({ solanaTokenAccountStatus: "not_queued" }).where(notCreated);
  }
  const [row] = await db.select().from(providers).where(eq(providers.id, provider.id));
  if (!row) throw new Error(`Provider ${provider.id} disappeared`);
  return providerFromRow(db, row, input.env);
}

/**
 * Records where a Provider's Solana USDC token account stands. The Solana
 * chain queue calls it as it creates the account.
 */
export async function setSolanaTokenAccountStatus(
  db: Db,
  input: { providerId: number; status: SolanaTokenAccountStatus },
): Promise<void> {
  await db
    .update(providers)
    .set({ solanaTokenAccountStatus: input.status })
    .where(eq(providers.id, input.providerId));
}

/**
 * Hands a Provider's NEAR Receiving Address to Herald's NEAR chain queue
 * (the `NearChainQueue` Durable Object in `apps/facilitator`), which creates
 * the account and registers it on USDC at most once, from the relayer, and
 * reports back through `setNearSetupStatus`. Resolves once the queue has the
 * job.
 */
export type NearSetupQueue = (job: NearSetupJob) => Promise<void>;

/**
 * Makes sure a Provider's NEAR Receiving Address is being set up: unless it
 * is `created`, hands it to the NEAR chain queue and marks it `queued`, as
 * `ensureSolanaTokenAccountQueued` does for Solana. The chain queue ignores a
 * job it already has and sets each account up at most once, so handing it
 * over again is safe, and it recovers a job the queue never received. If
 * the chain queue can't be reached, the Provider goes back to `not_queued`
 * for the next call to retry, and the failure is logged. Returns the
 * Provider as it now stands.
 */
export async function ensureNearSetupQueued(
  deps: { db: Db; queueNearSetup: NearSetupQueue },
  input: { provider: Provider; env: HeraldEnv },
): Promise<Provider> {
  const { db } = deps;
  const { provider } = input;
  const network = networkRegistry[input.env].find((n) => n.kind === "near");
  if (!network || provider.nearSetupStatus === "created") return provider;
  const notCreated = and(eq(providers.id, provider.id), ne(providers.nearSetupStatus, "created"));
  await db.update(providers).set({ nearSetupStatus: "queued" }).where(notCreated);
  try {
    await deps.queueNearSetup({
      network: network.caip2,
      providerId: provider.id,
      account: provider.nearAddress,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "near_setup_queue_failed",
        providerId: provider.id,
        error: String(error),
      }),
    );
    await db.update(providers).set({ nearSetupStatus: "not_queued" }).where(notCreated);
  }
  const [row] = await db.select().from(providers).where(eq(providers.id, provider.id));
  if (!row) throw new Error(`Provider ${provider.id} disappeared`);
  return providerFromRow(db, row, input.env);
}

/**
 * Queues the NEAR Receiving Address setup of up to `limit` Providers that
 * aren't on their way, oldest first, with `ensureNearSetupQueued`: those
 * `not_queued` (registered before NEAR and never signed in since, or given
 * up on by the chain queue) and any without a stored NEAR address, which is
 * derived and stored on the way. Sign-in queues the setup too; this reaches
 * Providers who don't sign in again. Does nothing in an environment that
 * lists no NEAR network. Returns how many Providers it handed over and how
 * many the chain queue couldn't take (they stay `not_queued`).
 */
export async function queuePendingNearSetups(
  deps: { db: Db; queueNearSetup: NearSetupQueue },
  input: { env: HeraldEnv; limit: number },
): Promise<{ queued: number; failed: number }> {
  const { db } = deps;
  if (!networkRegistry[input.env].some((n) => n.kind === "near")) return { queued: 0, failed: 0 };
  const rows = await db
    .select()
    .from(providers)
    .where(or(eq(providers.nearSetupStatus, "not_queued"), isNull(providers.nearAddress)))
    .orderBy(asc(providers.id))
    .limit(input.limit);
  let queued = 0;
  for (const row of rows) {
    const provider = await providerFromRow(db, row, input.env);
    const after = await ensureNearSetupQueued(deps, { provider, env: input.env });
    if (after.nearSetupStatus !== "not_queued") queued++;
  }
  return { queued, failed: rows.length - queued };
}

/**
 * Records where a Provider's NEAR Receiving Address setup stands. The NEAR
 * chain queue calls it as it sets the account up.
 */
export async function setNearSetupStatus(
  db: Db,
  input: { providerId: number; status: NearSetupStatus },
): Promise<void> {
  await db
    .update(providers)
    .set({ nearSetupStatus: input.status })
    .where(eq(providers.id, input.providerId));
}

/**
 * Registers a Provider Account in a Herald environment and stores its
 * Receiving Addresses, derived for that environment's MPC signer. Registering
 * an account that already exists returns the existing Provider unchanged.
 * Throws a `ZodError` on an invalid NEAR account id.
 */
export async function registerProvider(
  db: Db,
  input: { accountId: string; env: HeraldEnv },
): Promise<Provider> {
  const accountId = NearAccountIdSchema.parse(input.accountId);
  const addresses = deriveReceivingAddresses(accountId, input.env);
  await db
    .insert(providers)
    .values({
      accountId,
      evmAddress: addresses.evm,
      solanaAddress: addresses.solana,
      nearAddress: addresses.near,
    })
    .onConflictDoNothing({ target: providers.accountId });
  const [row] = await db.select().from(providers).where(eq(providers.accountId, accountId));
  if (!row) throw new Error(`Provider ${accountId} wasn't stored`);
  return providerFromRow(db, row, input.env);
}

/**
 * Parses a `providers` row read from the database of Herald environment
 * `env`. A row from before NEAR has no `near_address` (SQL can't derive it,
 * see its migration): it is derived here and stored, once, so every Provider
 * read through core has one. Every read of `providers` in core goes through
 * this.
 */
export async function providerFromRow(
  db: Db,
  row: typeof providers.$inferSelect,
  env: HeraldEnv,
): Promise<Provider> {
  if (row.nearAddress !== null) return ProviderSchema.parse(row);
  const nearAddress = deriveReceivingAddresses(NearAccountIdSchema.parse(row.accountId), env).near;
  await db
    .update(providers)
    .set({ nearAddress })
    .where(and(eq(providers.id, row.id), isNull(providers.nearAddress)));
  return ProviderSchema.parse({ ...row, nearAddress });
}

/** A Receiving Address and the labels of the networks Buyers pay it on. */
export type ReceivingAddressListing = { address: string; networks: string[] };

export type ProviderOverview = {
  accountId: NearAccountId;
  /** No networks in an environment that doesn't list NEAR. */
  near: ReceivingAddressListing & { setupStatus: NearSetupStatus };
  evm: ReceivingAddressListing;
  solana: ReceivingAddressListing & { tokenAccountStatus: SolanaTokenAccountStatus };
};

/**
 * A Provider's account and Receiving Addresses, each listed with the
 * networks it receives on in `env`, in Payment Option order, where its
 * Solana USDC token account stands and whether its NEAR Receiving Address
 * is set up. Null if no Provider has this id.
 */
export async function getProviderOverview(
  db: Db,
  input: { providerId: number; env: HeraldEnv },
): Promise<ProviderOverview | null> {
  const [row] = await db.select().from(providers).where(eq(providers.id, input.providerId));
  if (!row) return null;
  const provider = await providerFromRow(db, row, input.env);
  const networksOf = (kind: Network["kind"]) =>
    networkRegistry[input.env].filter((n) => n.kind === kind).map((n) => n.label);
  return {
    accountId: provider.accountId,
    near: {
      address: provider.nearAddress,
      networks: networksOf("near"),
      setupStatus: provider.nearSetupStatus,
    },
    evm: { address: provider.evmAddress, networks: networksOf("evm") },
    solana: {
      address: provider.solanaAddress,
      networks: networksOf("solana"),
      tokenAccountStatus: provider.solanaTokenAccountStatus,
    },
  };
}
