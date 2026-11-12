import {
  EvmAddressSchema,
  NearAccountIdSchema,
  SolanaAddressSchema,
  unhandledKind,
  type SweepStatus,
} from "@herald/core";
import type { SweepChainOption, SweepEntry } from "@herald/core/server";

// A Sweep is a withdrawal on screen: the code keeps the domain's words,
// the dashboard speaks the customer's.

/** The steps of starting a withdrawal, as the button names them while it waits. */
export type Step = "idle" | "planning" | "quoting" | "signing" | "submitting";

/** Why `address` isn't one to withdraw to on a network of this kind, or null if it is. */
export function addressProblem(address: string, kind: SweepChainOption["kind"]): string | null {
  switch (kind) {
    case "evm":
      return EvmAddressSchema.safeParse(address).success
        ? null
        : "Enter an address that starts with 0x and has 40 more characters.";
    case "solana":
      return SolanaAddressSchema.safeParse(address).success
        ? null
        : "Enter a Solana wallet address.";
    case "near":
      return NearAccountIdSchema.safeParse(address).success ? null : "Enter a NEAR account id.";
    default:
      return unhandledKind(kind);
  }
}

/**
 * Whether two addresses on a network of this kind are the same. EVM
 * addresses are case-insensitive; Solana's base58 ones and NEAR account ids
 * aren't.
 */
export function sameAddress(a: string, b: string, kind: SweepChainOption["kind"]): boolean {
  switch (kind) {
    case "evm":
      return a.toLowerCase() === b.toLowerCase();
    case "solana":
    case "near":
      return a === b;
    default:
      return unhandledKind(kind);
  }
}

/** The hint in an empty address field for a network of this kind. */
export function addressPlaceholder(kind: SweepChainOption["kind"]): string {
  switch (kind) {
    case "evm":
      return "0x…";
    case "solana":
      return "Solana wallet address";
    case "near":
      return "NEAR account id";
    default:
      return unhandledKind(kind);
  }
}

/** Seconds as `4:05`. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A withdrawal still moving: the history follows it until it settles. */
export const inFlight = (sweep: SweepEntry) =>
  sweep.status === "awaiting_signature" ||
  sweep.status === "submitted" ||
  sweep.status === "delivering" ||
  (sweep.status === "confirmed" && sweep.destinationKind !== "same_chain");

/** Each status of a withdrawal in plain words. */
export const statusBadges = {
  planned: { label: "Not approved", variant: "outline" },
  awaiting_signature: { label: "Approving", variant: "secondary" },
  submitted: { label: "Sending", variant: "secondary" },
  confirmed: { label: "Sent", variant: "success" },
  delivering: { label: "On its way", variant: "brand" },
  delivered: { label: "Arrived", variant: "success" },
  refunded: { label: "Refunded", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
} as const satisfies Record<SweepStatus, { label: string; variant: string }>;

/** What the wallet asks you to approve, once per withdrawal. */
export const approveOnce =
  "One NEAR transaction from your wallet, which pays a little NEAR in network fees.";
