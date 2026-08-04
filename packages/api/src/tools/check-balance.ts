import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createPublicClient, erc20Abi, formatEther, formatUnits, getAddress, http } from "viem";
import { arcTestnet } from "viem/chains";
import { eurc } from "viem/tokens";
import { z } from "zod";

import { userWallets } from "@ivanius.ai/db";

import type { Db } from "../lib/db";

export const checkBalanceInputSchema = z.object({
  chain: z.enum(["arc"]).default("arc"),
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
    description: `Fetch current wallet balance on a specific chain.
      NOTE: native token and USDC (ERC-20) token are the same token on Arc, treat them as one entity.`,
    inputSchema: checkBalanceInputSchema,
    outputSchema: checkBalanceOutputSchema,
    execute: async ({ chain, hideZeroBalance }) => {
      switch (chain) {
        case "arc": {
          const [wallet] = await db
            .select({
              address: userWallets.walletAddress,
            })
            .from(userWallets)
            .where(and(eq(userWallets.userId, userId), eq(userWallets.network, "evm")));
          if (!wallet) throw new Error("Arc wallet not initialized for this user");

          const resolvedAddress = getAddress(wallet.address);

          const publicClient = createPublicClient({
            transport: http(),
            chain: arcTestnet,
          });

          const [usdcBalance, eurcBalance] = await Promise.all([
            publicClient.getBalance({ address: resolvedAddress }),
            publicClient.readContract({
              abi: erc20Abi,
              address: eurc.addresses["5042002"],
              functionName: "balanceOf",
              args: [resolvedAddress],
            }),
          ]);

          return {
            address: resolvedAddress,
            balances: [
              {
                amount: formatEther(usdcBalance),
                token: {
                  name: publicClient.chain.nativeCurrency.name,
                  symbol: publicClient.chain.nativeCurrency.symbol,
                },
              },
              ...(eurcBalance >= 0n && !hideZeroBalance
                ? [
                    {
                      amount: formatUnits(eurcBalance, eurc.decimals),
                      token: {
                        name: eurc.name,
                        symbol: eurc.symbol,
                        tokenAddress: eurc.addresses["5042002"],
                      },
                    },
                  ]
                : []),
            ],
          };
        }
        default:
          throw new Error("Invalid chain provided");
      }
    },
  });
}
