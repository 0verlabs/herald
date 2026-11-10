/**
 * A timestamp as `2026-11-10 18:14 UTC`. The same on the server and in the
 * browser, so server-rendered pages hydrate without a mismatch.
 */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
