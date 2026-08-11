import type { AppKit } from "@circle-fin/app-kit";
import type { PrivyClient } from "@privy-io/node";
import { ViemAdapter } from "@circle-fin/adapter-viem-v2";
import { userWallets } from "@hrld/db";
import { createViemAccount } from "@privy-io/node/viem";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createPublicClient, createWalletClient, getAddress, http, isAddress } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";

export const sendTokenInputSchema = z.object({
  chain: z.enum(["arc"]).default("arc"),
  to: z
    .string()
    .refine((address) => isAddress(address, { strict: true }), "Invalid recipient address"),
  amount: z.string().transform(parseFloat).transform(String),
  token: z.enum(["USDC", "EURC"]).optional(),
});

export type SendTokenInput = z.infer<typeof sendTokenInputSchema>;

export const sendTokenOutputSchema = z.object({
  address: z.string(),
  txHash: z.string(),
  explorerUrl: z.string(),
});

export type SendTokenOutput = z.infer<typeof sendTokenOutputSchema>;

export interface CreateSendTokenToolArgs {
  db: Db;
  privy: PrivyClient;
  appKit: AppKit;
  userId: string;
  authorizationId: string;
  authorizationPrivateKey: string;
}

export function createSendTokenTools({
  db,
  privy,
  appKit,
  userId,
  authorizationId,
  authorizationPrivateKey,
}: CreateSendTokenToolArgs) {
  return tool({
    description: `Perform token transfer for a specific chain from user wallet.
    NOTE:
    - Empty token input = native token transfer`,
    inputSchema: sendTokenInputSchema,
    outputSchema: sendTokenOutputSchema,
    needsApproval: true,
    execute: async ({ chain, to, amount, token }) => {
      switch (chain) {
        case "arc": {
          const [wallet] = await db
            .select({
              address: userWallets.walletAddress,
            })
            .from(userWallets)
            .where(and(eq(userWallets.userId, userId), eq(userWallets.network, "evm")));
          if (!wallet) throw new Error("Arc wallet not initialized for this user");

          const privyWallet = await privy.wallets().getWalletByAddress({
            address: wallet.address,
          });

          const hasServerSigner = privyWallet.additional_signers.some(
            (signer) => signer.signer_id === authorizationId
          );
          if (!hasServerSigner)
            throw new Error("Agent didn't have access to perform token transfer for this wallet");

          const address = getAddress(wallet.address);

          const account = createViemAccount(privy, {
            walletId: privyWallet.id,
            address,
            authorizationContext: {
              authorization_private_keys: [authorizationPrivateKey],
            },
          });

          const supportedChains = appKit
            .getSupportedChains()
            .filter((chain) => chain.type === "evm");

          const adapter = new ViemAdapter(
            {
              getPublicClient: ({ chain }) =>
                createPublicClient({
                  chain,
                  transport: http(),
                }),
              getWalletClient: ({ chain }) =>
                createWalletClient({
                  account,
                  chain,
                  transport: http(),
                }),
            },
            { addressContext: "user-controlled", supportedChains }
          );

          const sendResult = await appKit.send({
            from: {
              adapter,
              chain: "Arc_Testnet",
            },
            to,
            amount: amount.toString(),
            token: !token ? "NATIVE" : token,
          });

          if (sendResult.state === "error" || !sendResult.txHash || !sendResult.explorerUrl)
            throw new Error(sendResult.errorMessage);

          return {
            address,
            txHash: sendResult.txHash,
            explorerUrl: sendResult.explorerUrl,
          };
        }
        default:
          throw new Error("Invalid chain provided");
      }
    },
  });
}
