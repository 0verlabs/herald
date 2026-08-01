import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { tool } from "ai";
import { z } from "zod";

export const checkBalanceOutputSchema = z.array(
  z.object({
    token: z.object({
      name: z.string(),
      symbol: z.string(),
      tokenAddress: z.string().optional(),
    }),
    amount: z.string(),
  })
);

export type CreateCheckBalanceToolsArgs = {
  client: CircleDeveloperControlledWalletsClient;
  walletId: string;
};

export function createCheckBalanceTools({ client, walletId }: CreateCheckBalanceToolsArgs) {
  return tool({
    description:
      "Fetch current wallet balance on Arc network, NOTE: native token and USDC (ERC-20) token are the same token on Arc, treat them as one entity",
    inputSchema: z.object({}),
    outputSchema: checkBalanceOutputSchema,
    execute: async () => {
      const getBalanceResponse = await client.getWalletTokenBalance({
        id: walletId,
      });

      if (!getBalanceResponse.data) return [];

      return (getBalanceResponse.data.tokenBalances ?? []).map(({ token, amount }) => ({
        token: {
          name: token.name ?? "Unknown",
          symbol: token.symbol ?? "Unknown",
          tokenAddress: token.tokenAddress,
        },
        amount,
      }));
    },
  });
}
