import type { Caip2 } from "../networks.ts";
import { decimalToBaseUnits } from "../price.ts";
import { viewAccount, type NearRpc } from "./near-protocol.ts";

const NEAR_DECIMALS = 24;
// What NEAR holds back from an account's balance per byte it stores.
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;

/**
 * Reads Herald's NEAR relayer and logs `near_relayer_low_balance` (with the
 * network, the relayer, its available balance and the threshold, both in
 * NEAR) if its available balance is below `threshold`, a NEAR amount like
 * `"0.5"`. Available is the liquid balance less what the account's storage
 * holds back; a relayer that doesn't exist has none. It never throws: a
 * failed read is logged as `near_relayer_balance_read_failed`, and a
 * threshold that isn't a NEAR amount as
 * `near_relayer_low_balance_threshold_invalid`, so nothing waiting on it
 * fails because of it.
 */
export async function warnIfNearRelayerLow(
  deps: { rpc: NearRpc },
  input: { network: Caip2; relayer: string; threshold: unknown },
): Promise<void> {
  const { network, relayer } = input;
  const threshold = nearToYocto(input.threshold);
  if (threshold === null) {
    console.error(
      JSON.stringify({
        event: "near_relayer_low_balance_threshold_invalid",
        network,
        threshold: input.threshold,
      }),
    );
    return;
  }
  let balance: bigint;
  try {
    balance = await availableBalance(deps.rpc, relayer);
  } catch (error) {
    console.warn(
      JSON.stringify({ event: "near_relayer_balance_read_failed", network, error: String(error) }),
    );
    return;
  }
  if (balance >= threshold) return;
  console.warn(
    JSON.stringify({
      event: "near_relayer_low_balance",
      network,
      relayer,
      balance: yoctoToNear(balance),
      threshold: yoctoToNear(threshold),
    }),
  );
}

/** `accountId`'s spendable yoctoNEAR: `amount` less storage not covered by `locked`. */
async function availableBalance(rpc: NearRpc, accountId: string): Promise<bigint> {
  const account = await viewAccount(rpc, accountId);
  if (account === null) return 0n;
  const {
    amount,
    locked = "0",
    storage_usage: storage = 0,
  } = account as typeof account & {
    locked?: unknown;
    storage_usage?: unknown;
  };
  if (
    typeof amount !== "string" ||
    !/^\d+$/.test(amount) ||
    typeof locked !== "string" ||
    !/^\d+$/.test(locked) ||
    typeof storage !== "number" ||
    !Number.isSafeInteger(storage) ||
    storage < 0
  ) {
    throw new Error(`${rpc.name} answered view_account without a balance`);
  }
  const heldForStorage = BigInt(storage) * STORAGE_YOCTO_PER_BYTE - BigInt(locked);
  const available = BigInt(amount) - (heldForStorage > 0n ? heldForStorage : 0n);
  return available > 0n ? available : 0n;
}

/** A NEAR amount (`"0.5"`) in yoctoNEAR; null if it isn't one. */
function nearToYocto(amount: unknown): bigint | null {
  if (typeof amount !== "string") return null;
  try {
    return BigInt(decimalToBaseUnits(amount, NEAR_DECIMALS));
  } catch {
    return null;
  }
}

/** yoctoNEAR as a NEAR amount without trailing zeros: `"0.39818"`. */
function yoctoToNear(yocto: bigint): string {
  const digits = yocto.toString().padStart(NEAR_DECIMALS + 1, "0");
  const whole = digits.slice(0, -NEAR_DECIMALS);
  const fraction = digits.slice(-NEAR_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
