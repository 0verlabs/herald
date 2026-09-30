import { Address } from "viem";
import { EvmChain } from "./chain";

export const identityRegistryByChain = {
  "0g": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
} as const satisfies Record<EvmChain, Address>;

export const reputationRegistryByChain = {
  "0g": "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
} as const satisfies Record<EvmChain, Address>;

export const agenticCommerceByChain = {
  "0g": "0x6a9012eb291a1cc018470e7e436a87d4c010ee0e",
} as const satisfies Record<EvmChain, Address>;
