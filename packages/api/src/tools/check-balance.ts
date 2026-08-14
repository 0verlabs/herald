import { userWallets } from "@hrld/db";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";
import type { EvmChainConfig } from "../types/chain";
import { chains } from "../lib/chains";
import { rpcUrls } from "../lib/rpc";
import { callableChainSlugSchema } from "../types/chain";

export const checkBalanceInputSchema = z.object({
  chain: callableChainSlugSchema.default("0g-testnet"),
  hideZeroBalance: z.boolean().default(true),
});

export type CheckBalanceInput = z.infer<typeof checkBalanceInputSchema>;

export const checkBalanceOutputSchema = z.object({
  address: z.string(),
  chain: z.string(),
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
      NOTE: the native token of 0G is 0G. USDC is a separate token and is not deployed on
      0G Galileo Testnet, so it is absent from testnet balances.`,
    inputSchema: checkBalanceInputSchema,
    outputSchema: checkBalanceOutputSchema,
    execute: async ({ chain, hideZeroBalance }) => {
      const [wallet] = await db
        .select({
          address: userWallets.walletAddress,
        })
        .from(userWallets)
        .where(and(eq(userWallets.userId, userId), eq(userWallets.network, "evm")));
      if (!wallet) throw new Error("Wallet not initialized for this user");

      const address = getAddress(wallet.address);
      // Widened to the general config on purpose: every currently-callable chain happens to have
      // no USDC deployment, and without this the compiler narrows `usdc` to `never` and the token
      // branch below becomes unreachable code that has to be deleted and rewritten later.
      const config: EvmChainConfig = chains[chain];
      const native = config.tokens.native;
      const usdc = config.tokens.usdc;

      const publicClient = createPublicClient({
        chain: config.chain,
        transport: http(rpcUrls[chain]),
      });

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
        chain,
        // The native balance is always reported, even at zero: "you hold no 0G" is an answer,
        // whereas an empty list reads as "we couldn't find out".
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
