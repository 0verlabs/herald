import type { PrivyClient } from "@privy-io/node";
import { chainSchema, Token, tokenSchema } from "@hrld/core/types";
import { userWallets } from "@hrld/db";
import { createViemAccount } from "@privy-io/node/viem";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createWalletClient, erc20Abi, getAddress, http, isAddress, parseUnits } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";
import { chainConfigs, viemChains } from "../config/chain";
import { tokenConfigs } from "../config/token";
import { isTokenConfig } from "../lib/tokens";
import { NativeTokenConfig, TokenConfig } from "../types/token";

export const sendTokenInputSchema = z.object({
  chain: chainSchema,
  to: z
    .string()
    .refine((address) => isAddress(address, { strict: true }), "Invalid recipient address"),
  amount: z.string().transform(parseFloat).transform(String),
  token: tokenSchema,
});

export type SendTokenInput = z.infer<typeof sendTokenInputSchema>;

export const sendTokenOutputSchema = z.object({
  address: z.string(),
  txHash: z.string(),
  // explorerUrl: z.string(),
});

export type SendTokenOutput = z.infer<typeof sendTokenOutputSchema>;

export interface CreateSendTokenToolArgs {
  db: Db;
  privy: PrivyClient;
  userId: string;
  authorizationId: string;
  authorizationPrivateKey: string;
}

export function createSendTokenTools({
  db,
  privy,
  userId,
  authorizationId,
  authorizationPrivateKey,
}: CreateSendTokenToolArgs) {
  return tool({
    description: `Perform token transfer for a specific chain from user wallet.`,
    inputSchema: sendTokenInputSchema,
    outputSchema: sendTokenOutputSchema,
    needsApproval: true,
    execute: async ({ chain, to, amount, token }) => {
      const chainConfig = chainConfigs[chain];

      const [wallet] = await db
        .select({
          address: userWallets.walletAddress,
        })
        .from(userWallets)
        .where(and(eq(userWallets.userId, userId), eq(userWallets.network, chainConfig.network)));
      if (!wallet) throw new Error("Wallet not initialized for this user");

      const privyWallet = await privy.wallets().getWalletByAddress({
        address: wallet.address,
      });

      const hasServerSigner = privyWallet.additional_signers.some(
        (signer) => signer.signer_id === authorizationId
      );
      if (!hasServerSigner)
        throw new Error("Agent didn't have access to perform token transfer for this wallet");

      const address = getAddress(wallet.address);

      const walletClient = createWalletClient({
        account: createViemAccount(privy, {
          walletId: privyWallet.id,
          address,
          authorizationContext: {
            authorization_private_keys: [authorizationPrivateKey],
          },
        }),
        chain: viemChains[chain],
        transport: http(chainConfig.rpcUrl),
      });

      const tokenConfig = tokenConfigs[chain][token];
      if (!tokenConfig) throw new Error("Token not supported for this chain");

      const txHash = isTokenConfig(tokenConfig)
        ? await walletClient.writeContract({
            abi: erc20Abi,
            address: getAddress(tokenConfig.address),
            functionName: "transfer",
            args: [getAddress(to), parseUnits(amount, tokenConfig.decimals)],
          })
        : await walletClient.sendTransaction({
            to: getAddress(to),
            value: parseUnits(amount, tokenConfig.decimals),
          });

      return {
        address,
        txHash,
        // explorerUrl: chains[chain].txUrl(txHash),
      };
    },
  });
}
