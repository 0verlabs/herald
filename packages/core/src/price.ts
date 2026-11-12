import { z } from "zod";

/** Decimals of USDC on every chain Herald lists. */
export const USDC_DECIMALS = 6;

/**
 * A Price: the USD amount a Provider charges per request, as a decimal string
 * with an optional `$` (`"$0.01"`). USDC is treated as exactly $1, so a Price
 * can't be finer than USDC's smallest unit, $0.000001.
 */
export const PriceSchema = z
  .string()
  .regex(/^\$?\d+(\.\d+)?$/, 'must be a USD amount like "$0.01"')
  .refine(
    (price) => (price.split(".")[1]?.length ?? 0) <= USDC_DECIMALS,
    `has more than ${USDC_DECIMALS} decimal places; the smallest USDC amount is $0.000001`,
  )
  .refine((price) => /[1-9]/.test(price), "must be more than $0");
export type Price = z.infer<typeof PriceSchema>;

/**
 * Converts a Price into base units of a token worth exactly $1, such as
 * USDC. Works on the decimal string, never on floats, so `"$0.1"` is exactly
 * 100000 base units at 6 decimals.
 */
export function priceToBaseUnits(price: Price, decimals: number): string {
  const [whole = "", fraction = ""] = PriceSchema.parse(price).replace(/^\$/, "").split(".");
  if (fraction.length > decimals) {
    throw new RangeError(`Price ${price} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0")).toString();
}

/**
 * Converts a non-negative decimal amount (`"0.15"`) into base units of a
 * token with `decimals` decimals, on the string, never on floats. Throws a
 * `RangeError` on anything else, or on more decimal places than the token
 * has.
 */
export function decimalToBaseUnits(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new RangeError(`${amount} is not a decimal amount`);
  const [whole = "", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new RangeError(`${amount} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0")).toString();
}
