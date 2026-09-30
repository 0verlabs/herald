import { Address } from "viem";
import { EvmChain } from "./chain";

export const WRAPPED_NATIVE_TOKEN = {
  "0g": "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
} satisfies Record<EvmChain, Address>;
