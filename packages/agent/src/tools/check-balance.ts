import { chainSchema } from "@hrld/core/types";
import { userWallets } from "@hrld/db";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";
import { chainConfigs, viemChains } from "../config/chain";
import { tokenConfigs } from "../config/token";

export const checkBalanceInputSchema = z.object({
  chain: chainSchema,
  hideZeroBalance: z.boolean().default(true),
});

export type CheckBalanceInput = z.infer<typeof checkBalanceInputSchema>;

export const checkBalanceOutputSchema = z.object({
  address: z.string(),
  balances: z.array(
    z.object({
      token: z.object({
        name: z.string(),
        symbol: z.string(),
        tokenAddress: z.string().optional(),
      }),
      amount: z.string(),
    })
  ),
});

export type CheckBalanceOutput = z.infer<typeof checkBalanceOutputSchema>;

export interface CreateCheckBalanceToolArgs {
  db: Db;
  userId: string;
}

export function createCheckBalanceTools({ db, userId }: CreateCheckBalanceToolArgs) {
  return tool({
    type: "dynamic",
    description: `Fetch current wallet balance on a specific chain.`,
    inputSchema: checkBalanceInputSchema,
    outputSchema: checkBalanceOutputSchema,
    execute: async ({ chain, hideZeroBalance }) => {
      const [wallet] = await db
        .select({
          address: userWallets.wallet_address,
        })
        .from(userWallets)
        .where(and(eq(userWallets.user_id, userId), eq(userWallets.network, "evm")));
      if (!wallet) throw new Error("Wallet not initialized for this user");

      const address = getAddress(wallet.address);

      const chainConfig = chainConfigs[chain];

      const publicClient = createPublicClient({
        chain: viemChains[chain],
        transport: http(chainConfig.rpcUrl),
      });

      const native = tokenConfigs[chain].native;
      const usdc = tokenConfigs[chain].usdc;

      const [nativeBalance, usdcBalance] = await Promise.all([
        publicClient.getBalance({ address }),
        usdc
          ? publicClient.readContract({
              abi: erc20Abi,
              address: getAddress(usdc.address),
              functionName: "balanceOf",
              args: [address],
            })
          : undefined,
      ]);

      const tokenBalances =
        usdc && usdcBalance !== undefined
          ? [
              {
                amount: formatUnits(usdcBalance, usdc.decimals),
                token: {
                  name: usdc.name,
                  symbol: usdc.symbol,
                  tokenAddress: usdc.address,
                },
              },
            ]
          : [];

      return {
        address,
        balances: [
          {
            amount: formatUnits(nativeBalance, native.decimals),
            token: {
              name: native.name,
              symbol: native.symbol,
            },
          },
          ...(hideZeroBalance
            ? tokenBalances.filter((balance) => Number(balance.amount) > 0)
            : tokenBalances),
        ],
      };
    },
  });
}
