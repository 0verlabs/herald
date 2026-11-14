import {
  EvmAddressSchema,
  NearAccountIdSchema,
  NearImplicitAccountSchema,
  SolanaAddressSchema,
  unhandledKind,
  type SweepStatus,
} from "@herald/core";
import type { SweepChainOption, SweepEntry } from "@herald/core/server";
import type { NearGasPayer } from "@/lib/near-wallet";

// A Sweep is a withdrawal on screen: the code keeps the domain's words,
// the dashboard speaks the customer's.

/**
 * The steps of starting a withdrawal, as the button names them while it
 * waits. `preparing` is Herald creating an implicit Provider Account that
 * isn't on NEAR yet, before a sponsored approval (#50).
 */
export type Step = "idle" | "planning" | "quoting" | "preparing" | "signing" | "submitting";

/**
 * What the button says while Herald creates an implicit Provider Account
 * that isn't on NEAR yet, before the wallet's first sponsored approval
 * (`prepareProviderAccount`).
 */
export const PREPARING_ACCOUNT_LABEL = "Herald is preparing your NEAR account…";

// How often a call is made again when Herald's relayer didn't answer, and
// how long apart (`askRelayer`).
const RELAYER_ATTEMPTS = 3;
const RELAYER_RETRY_MS = 2_000;

/**
 * Calls `ask`, and again up to `RELAYER_ATTEMPTS` times in all,
 * `RELAYER_RETRY_MS` apart, while `again` says its answer is worth asking
 * again for (Herald's relayer didn't answer). Answers the last answer.
 * Only for calls that are safe to repeat: the relayer sends each approval,
 * and creates each account, at most once.
 */
export async function askRelayer<T>(
  ask: () => Promise<T>,
  again: (answer: T) => boolean,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const answer = await ask();
    if (attempt >= RELAYER_ATTEMPTS || !again(answer)) return answer;
    await new Promise((resolve) => setTimeout(resolve, RELAYER_RETRY_MS));
  }
}

/** The `prepareSponsoredAccount` server function, as `useServerFn` hands it over. */
export type PrepareSponsoredAccount = (input: {
  data: { sweepId: number };
}) => Promise<{ ok: true } | { ok: false; message: string; retry: boolean }>;

/**
 * Before the wallet signs a sponsored withdrawal (Herald paying the NEAR
 * gas): has Herald create the Provider Account if it is an implicit account
 * that isn't on NEAR yet (#50), since the signed approval can't land
 * without it. Call it once before the wallet prompt, for one withdrawal or a
 * whole "Sweep all" batch (with any one of its Sweeps). A named account
 * needs nothing, so nothing is asked. Otherwise `onPreparing` runs (show
 * `PREPARING_ACCOUNT_LABEL`) and this resolves once the account is on NEAR,
 * or throws why it isn't, for the Provider to try again.
 */
export async function prepareProviderAccount(
  prepare: PrepareSponsoredAccount,
  input: { accountId: string; sweepId: number; onPreparing: () => void },
): Promise<void> {
  if (!NearImplicitAccountSchema.safeParse(input.accountId).success) return;
  input.onPreparing();
  const prepared = await askRelayer(
    () => prepare({ data: { sweepId: input.sweepId } }),
    (answer) => !answer.ok && answer.retry,
  );
  if (!prepared.ok) throw new Error(prepared.message);
}

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
      return NearAccountIdSchema.safeParse(address).success
        ? null
        : "Enter a NEAR account id, such as alice.near, or a 64-character implicit account. It's lowercase, without spaces.";
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

/**
 * Who pays the NEAR gas of the approval (ADR 0010), in plain words, by who
 * pays it: Herald with a wallet that signs delegate actions, your wallet
 * otherwise, and either while no wallet is connected yet (`unknown`).
 * `approval` is what the wallet asks you to approve, once per withdrawal;
 * `gas` is the line saying who pays.
 */
const NEAR_GAS_WORDS = {
  herald: {
    approval: "One approval in your NEAR wallet. Herald pays its NEAR gas.",
    gas: "Herald pays the NEAR gas.",
  },
  provider: {
    approval: "One NEAR transaction from your wallet, which pays a little NEAR in network fees.",
    gas: "Your wallet pays the NEAR gas, a little NEAR. Wallets that sign delegate actions, such as Meteor, let Herald pay it.",
  },
  unknown: {
    approval: "One approval in your NEAR wallet.",
    gas: "Herald pays the NEAR gas if your wallet signs delegate actions, such as Meteor. Otherwise your wallet pays a little NEAR.",
  },
} as const satisfies Record<NearGasPayer | "unknown", { approval: string; gas: string }>;

/** What the wallet asks you to approve, once per withdrawal, and who pays its NEAR gas. */
export function approveOnce(payer: NearGasPayer | null): string {
  return NEAR_GAS_WORDS[payer ?? "unknown"].approval;
}

/** Who pays the NEAR gas of the approval, in plain words (`NEAR_GAS_WORDS`). */
export function nearGasLine(payer: NearGasPayer | null): string {
  return NEAR_GAS_WORDS[payer ?? "unknown"].gas;
}
