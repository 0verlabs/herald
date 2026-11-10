import type { Caip2 } from "@herald/core";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { encodeFunctionData, type Abi } from "viem";
import { evmGasAccount, evmPublicClient } from "./chains.ts";

/**
 * The signer the stock `@x402/evm` exact mechanism settles with. Reads go
 * straight to the network's RPC endpoint; the one write it makes,
 * `transferWithAuthorization`, goes through the network's chain queue.
 *
 * The receipt wait is `SETTLE_RECEIPT_TIMEOUT_MS`, well inside the stock
 * HTTPFacilitatorClient's 90 s timeout. When it runs out, the mechanism
 * answers `settlement_pending` and the resource server retries once.
 */
export function facilitatorEvmSigner(
  env: CloudflareBindings,
  network: Caip2,
): FacilitatorEvmSigner {
  const client = evmPublicClient(env, network);
  const address = evmGasAccount(env).address;
  const receiptTimeout = Number(env.SETTLE_RECEIPT_TIMEOUT_MS);
  return {
    getAddresses: () => [address],
    readContract: (args) => client.readContract({ ...args, abi: args.abi as Abi }),
    verifyTypedData: (args) =>
      client.verifyTypedData(args as Parameters<typeof client.verifyTypedData>[0]),
    getCode: (args) => client.getCode(args),
    waitForTransactionReceipt: (args) =>
      client.waitForTransactionReceipt({
        hash: args.hash,
        timeout: Math.min(args.timeout ?? receiptTimeout, receiptTimeout),
      }),
    writeContract: async (args) => {
      if (args.functionName !== "transferWithAuthorization") {
        throw new Error(
          `Herald's facilitator only settles EIP-3009 transferWithAuthorization, not ${args.functionName}`,
        );
      }
      const data = encodeFunctionData({
        abi: args.abi as Abi,
        functionName: args.functionName,
        args: args.args,
      });
      const result = await env.EVM_CHAIN_QUEUE.getByName(network).submitTransferWithAuthorization({
        network,
        asset: args.address,
        data,
        ...(args.dataSuffix && { dataSuffix: args.dataSuffix }),
      });
      if (!result.ok) throw new Error(result.message);
      return result.hash;
    },
    sendTransaction: async () => {
      // Only reached for ERC-6492 smart-wallet deployment, which the
      // mechanism keeps off unless factories are allowlisted.
      throw new Error("Herald's facilitator does not deploy smart wallets");
    },
  };
}

/**
 * The stock mechanism's store of broadcast-but-unconfirmed settlements, kept
 * in the network's chain queue so a retry on any isolate finds it.
 */
export function pendingSettlementStore(
  env: CloudflareBindings,
  network: Caip2,
): PendingSettlementStore {
  const queue = env.EVM_CHAIN_QUEUE.getByName(network);
  return {
    get: async (key) => (await queue.getPendingSettlement(key)) ?? undefined,
    set: async (key, txHash) => {
      await queue.setPendingSettlement(key, txHash);
    },
    delete: async (key) => {
      await queue.deletePendingSettlement(key);
    },
  };
}
