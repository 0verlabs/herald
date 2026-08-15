import { userWallets } from "@hrld/db";
import { tool } from "ai";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";

export const getWalletsInputSchema = z.object({});

export type GetWalletsInput = z.infer<typeof getWalletsInputSchema>;

export const getWalletsOutputSchema = z.array(
  z.object({
    network: z.enum(["evm"]),
    address: z.string(),
  })
);

export type GetWalletsOutput = z.infer<typeof getWalletsOutputSchema>;

export interface CreateGetWalletsToolArgs {
  db: Db;
  userId: string;
}

export function createGetWalletsTools({ db, userId }: CreateGetWalletsToolArgs) {
  return tool({
    description: "Get list of wallet linked to user account",
    inputSchema: getWalletsInputSchema,
    outputSchema: getWalletsOutputSchema,
    execute: async () => {
      const wallets = await db
        .select({
          address: userWallets.walletAddress,
          network: userWallets.network,
        })
        .from(userWallets)
        .where(eq(userWallets.userId, userId));

      return wallets.map((wallet) => ({
        network: wallet.network,
        address: wallet.network === "evm" ? getAddress(wallet.address) : wallet.address,
      }));
    },
  });
}
