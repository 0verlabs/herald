import { stringToHex } from "viem";

export const agentEntityId = (
  chainId: bigint | number,
  registryAddress: string,
  agentId: string,
) => {
  return stringToHex(`${chainId.toString()}:${registryAddress.toLowerCase()}:${agentId}`);
};
