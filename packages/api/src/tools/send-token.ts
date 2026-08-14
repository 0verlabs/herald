import type { PrivyClient } from "@privy-io/node";
import { userWallets } from "@hrld/db";
import { createViemAccount } from "@privy-io/node/viem";
import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { createWalletClient, erc20Abi, getAddress, http, isAddress, parseUnits } from "viem";
import { z } from "zod";

import type { Db } from "../lib/db";
import { chains, requireUsdc } from "../lib/chains";
import { rpcUrls } from "../lib/rpc";
import { callableChainSlugSchema } from "../types/chain";

export const sendTokenInputSchema = z.object({
  chain: callableChainSlugSchema.default("0g-testnet"),
  to: z
    .string()
    .refine((address) => isAddress(address, { strict: true }), "Invalid recipient address"),
  amount: z.string().transform(parseFloat).transform(String),
  token: z.enum(["USDC"]).optional(),
});

export type SendTokenInput = z.infer<typeof sendTokenInputSchema>;

export const sendTokenOutputSchema = z.object({
  address: z.string(),
  chain: z.string(),
  txHash: z.string(),
  explorerUrl: z.string(),
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
    description: `Perform token transfer for a specific chain from user wallet.
    NOTE:
    - Empty token input = native token transfer`,
    inputSchema: sendTokenInputSchema,
    outputSchema: sendTokenOutputSchema,
    needsApproval: true,
    execute: async ({ chain, to, amount, token }) => {
      const [wallet] = await db
        .select({
          address: userWallets.walletAddress,
        })
        .from(userWallets)
        .where(and(eq(userWallets.userId, userId), eq(userWallets.network, "evm")));
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
        chain: chains[chain].chain,
        transport: http(rpcUrls[chain]),
      });

      // `requireUsdc` throws where the token has no deployment, so an unsupported token never
      // reaches the network. Both branches take their decimals from the registry so a chain
      // whose native currency isn't 18-decimal can't silently send the wrong amount.
      const usdc = token ? requireUsdc(chain) : undefined;

      const txHash = usdc
        ? await walletClient.writeContract({
            abi: erc20Abi,
            address: getAddress(usdc.address),
            functionName: "transfer",
            args: [getAddress(to), parseUnits(amount, usdc.decimals)],
          })
        : await walletClient.sendTransaction({
            to: getAddress(to),
            value: parseUnits(amount, chains[chain].tokens.native.decimals),
          });

      return {
        address,
        chain,
        txHash,
        explorerUrl: chains[chain].txUrl(txHash),
      };
    },
  });
}
