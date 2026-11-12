import { providers } from "@herald/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { networkRegistry, type Caip2, type Network } from "../networks.ts";
import { deriveReceivingAddresses } from "../receiving-addresses.ts";
import {
  NearAccountIdSchema,
  ProviderSchema,
  type HeraldEnv,
  type NearAccountId,
  type Provider,
  type SolanaAddress,
  type SolanaTokenAccountStatus,
} from "../schemas.ts";
import type { Db } from "./db.ts";
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
  evm: ReceivingAddressListing;
  solana: ReceivingAddressListing & { tokenAccountStatus: SolanaTokenAccountStatus };
};

/**
 * A Provider's account and Receiving Addresses, each listed with the
 * networks it receives on in `env`, in Payment Option order, and where its
 * Solana USDC token account stands. Null if no Provider has this id.
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
    evm: { address: provider.evmAddress, networks: networksOf("evm") },
    solana: {
      address: provider.solanaAddress,
      networks: networksOf("solana"),
      tokenAccountStatus: provider.solanaTokenAccountStatus,
    },
  };
}
