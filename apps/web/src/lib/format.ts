import { USDC_DECIMALS } from "@herald/core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A timestamp as `10 Nov 2026, 18:14 UTC`. The same on the server and in
 * the browser, so server-rendered pages hydrate without a mismatch.
 */
export function formatUtc(date: Date): string {
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const time = date.toISOString().slice(11, 16);
  return `${day} ${month} ${date.getUTCFullYear()}, ${time} UTC`;
}

/** A timestamp's date alone, as `10 Nov 2026`. */
export function formatUtcDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** A timestamp's time alone, as `18:14 UTC`. */
export function formatUtcTime(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

/**
 * A stablecoin amount in base units (a decimal string) as `1,234.50`:
 * grouped thousands, at least two decimals and no trailing zeros past them.
 * Works on the string, never on floats, so every base unit shows.
 */
export function formatCoinAmount(baseUnits: string, decimals: number): string {
  const digits = baseUnits.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-decimals).replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
}

/** A USDC amount in base units as `1,234.50` (see `formatCoinAmount`). */
export function formatUsdc(baseUnits: string): string {
  return formatCoinAmount(baseUnits, USDC_DECIMALS);
}

/** A long value such as an address or hash as `0x0000…b0b0`. */
export function shortenMiddle(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Base units of a token with `decimals` decimals as a plain decimal, exactly:
 * `"150000"` at 6 decimals is `"0.15"`. For form fields.
 */
export function baseUnitsToDecimal(baseUnits: string, decimals: number): string {
  const digits = baseUnits.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * A token amount in base units as `1,234.5678`: grouped thousands and at
 * most `maxFractionDigits` decimals, cut rather than rounded, so a balance
 * never shows more than it is. Works on the string, never on floats.
 */
export function formatTokenAmount(
  baseUnits: string,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const [whole = "0", fraction = ""] = baseUnitsToDecimal(baseUnits, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  return shown ? `${grouped}.${shown}` : grouped;
}

/** How many `part` is of `whole`, both in base units, as a percentage from 0 to 100. */
export function shareOf(part: string, whole: string): number {
  const total = BigInt(whole);
  if (total === 0n) return 0;
  return Number((BigInt(part) * 10_000n) / total) / 100;
}
