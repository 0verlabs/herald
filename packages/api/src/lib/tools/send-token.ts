import type { CircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import type { AppKit } from "@circle-fin/app-kit";
import type { Address } from "viem";
import { tool } from "ai";
import { isAddress } from "viem";
import { z } from "zod";

export const sendTokenInputSchema = z.object({
  to: z
    .string()
    .refine((address) => isAddress(address, { strict: true }), "Invalid recipient address"),
  amount: z.number().min(10 / 10 ** 18),
  token: z.enum(["USDC", "EURC"]).optional(),
});

export type SendTokenInput = z.infer<typeof sendTokenInputSchema>;

export const sendTokenOutputSchema = z.object({
  txHash: z.string(),
  explorerUrl: z.string(),
});

export type CreateSendTokenToolsArgs = {
  appKit: AppKit;
  adapter: CircleWalletsAdapter;
  address: Address;
};

export function createSendTokenTools({ appKit, adapter, address }: CreateSendTokenToolsArgs) {
  return tool({
    description:
      "Perform token transfer from user wallet, NOTE: empty result mean transaction failed",
    inputSchema: sendTokenInputSchema,
    outputSchema: sendTokenOutputSchema,
    needsApproval: true,
    execute: async ({ to, amount, token }) => {
      const sendTokenResult = await appKit.send({
        from: {
          adapter,
          chain: "Arc_Testnet",
          address,
        },
        to,
        amount: amount.toString(),
        token: !token || token === "USDC" ? "NATIVE" : token,
      });

      return {
        txHash: sendTokenResult.txHash ?? "",
        explorerUrl: sendTokenResult.explorerUrl ?? "",
      };
    },
  });
}
