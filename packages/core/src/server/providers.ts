import { providers } from "@herald/db/schema";
import { eq } from "drizzle-orm";
import { networkRegistry, type Network } from "../networks.ts";
import { deriveReceivingAddresses } from "../receiving-addresses.ts";
import {
  NearAccountIdSchema,
  ProviderSchema,
  type HeraldEnv,
  type NearAccountId,
  type Provider,
} from "../schemas.ts";
import type { Db } from "./db.ts";

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
    .values({ accountId, evmAddress: addresses.evm, solanaAddress: addresses.solana })
    .onConflictDoNothing({ target: providers.accountId });
  const [row] = await db.select().from(providers).where(eq(providers.accountId, accountId));
  return ProviderSchema.parse(row);
}

/** A Receiving Address and the labels of the networks Buyers pay it on. */
export type ReceivingAddressListing = { address: string; networks: string[] };

export type ProviderOverview = {
  accountId: NearAccountId;
  evm: ReceivingAddressListing;
  solana: ReceivingAddressListing;
};

/**
 * A Provider's account and Receiving Addresses, each listed with the
 * networks it receives on in `env`, in Payment Option order. Null if no
 * Provider has this id.
 */
export async function getProviderOverview(
  db: Db,
  input: { providerId: number; env: HeraldEnv },
): Promise<ProviderOverview | null> {
  const [row] = await db.select().from(providers).where(eq(providers.id, input.providerId));
  if (!row) return null;
  const provider = ProviderSchema.parse(row);
  const networksOf = (kind: Network["kind"]) =>
    networkRegistry[input.env].filter((n) => n.kind === kind).map((n) => n.label);
  return {
    accountId: provider.accountId,
    evm: { address: provider.evmAddress, networks: networksOf("evm") },
    solana: { address: provider.solanaAddress, networks: networksOf("solana") },
  };
}
