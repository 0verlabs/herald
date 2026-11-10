import type { Caip2 } from "@herald/core";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { encodeFunctionData, type Abi } from "viem";
import { evmGasAccount, evmPublicClient } from "./chains.ts";

// The receipt wait stays well inside the stock HTTPFacilitatorClient's 90 s
// request timeout.
const CONFIRMATION_TIMEOUT_MS = 30_000;

/**
 * The signer the stock `@x402/evm` exact mechanism settles with. Reads go
 * straight to the network's RPC endpoint; the one write it makes,
 * `transferWithAuthorization`, goes through the network's chain queue.
 */
export function facilitatorEvmSigner(
  env: CloudflareBindings,
  network: Caip2,
): FacilitatorEvmSigner {
  const client = evmPublicClient(env, network);
  const address = evmGasAccount(env).address;
  return {
    getAddresses: () => [address],
    readContract: (args) => client.readContract({ ...args, abi: args.abi as Abi }),
    verifyTypedData: (args) =>
      client.verifyTypedData(args as Parameters<typeof client.verifyTypedData>[0]),
    getCode: (args) => client.getCode(args),
    waitForTransactionReceipt: (args) =>
      client.waitForTransactionReceipt({
        hash: args.hash,
        timeout: Math.min(args.timeout ?? CONFIRMATION_TIMEOUT_MS, CONFIRMATION_TIMEOUT_MS),
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
      return env.EVM_CHAIN_QUEUE.getByName(network).submitTransferWithAuthorization({
        network,
        asset: args.address,
        data,
        ...(args.dataSuffix && { dataSuffix: args.dataSuffix }),
      });
    },
    sendTransaction: async () => {
      // Only reached for ERC-6492 smart-wallet deployment, which the
      // mechanism keeps off unless factories are allowlisted.
      throw new Error("Herald's facilitator does not deploy smart wallets");
    },
  };
}
