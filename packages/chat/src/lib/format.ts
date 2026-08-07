const compactNumberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompactNumber(value: number) {
  return compactNumberFormat.format(value);
}

const priceFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** `0.01` — two-decimal price, shown next to the USDC logo. */
export function formatPrice(value: number) {
  return priceFormat.format(value);
}
