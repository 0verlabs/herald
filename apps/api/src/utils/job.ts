import { stringToHex } from "viem";

export const jobEntityId = (chainId: bigint | number, contractAddress: string, jobId: string) => {
  return stringToHex(`${chainId.toString()}:${contractAddress.toLowerCase()}:${jobId}`);
};
