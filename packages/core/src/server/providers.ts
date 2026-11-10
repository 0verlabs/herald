import { providers } from "@herald/db/schema";
import { eq } from "drizzle-orm";
import { deriveReceivingAddresses } from "../receiving-addresses.ts";
import { NearAccountIdSchema, ProviderSchema, type HeraldEnv, type Provider } from "../schemas.ts";
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
