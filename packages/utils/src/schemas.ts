import { isAddress } from "viem";
import { z } from "zod";

// Agent ids are uint256 values; 0 means "no agent" on-chain, which callers can
// use to find jobs without an assigned agent. The string input side keeps the
// schema representable in JSON Schema, which both the OpenAPI doc and MCP tool
// listing require.
export const agentIdSchema = z.string().pipe(z.coerce.bigint<string>().nonnegative());

// Job ids are uint256 values assigned by the escrow contract.
export const jobIdSchema = z.string().pipe(z.coerce.bigint<string>().nonnegative());

export const addressSchema = z.string().refine((value) => isAddress(value), "Invalid EVM address");
