import { USDC_DECIMALS } from "@herald/core";

/**
 * A timestamp as `2026-11-10 18:14 UTC`. The same on the server and in the
 * browser, so server-rendered pages hydrate without a mismatch.
 */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * A USDC amount in base units (a decimal string) as `1,234.50`: grouped
 * thousands, at least two decimals and no trailing zeros past them. Works on
 * the string, never on floats, so every base unit shows.
 */
export function formatUsdc(baseUnits: string): string {
  const digits = baseUnits.padStart(USDC_DECIMALS + 1, "0");
  const whole = digits.slice(0, -USDC_DECIMALS).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = digits.slice(-USDC_DECIMALS).replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${fraction}`;
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
