/**
 * A message from Herald's server in the dashboard's everyday words. The
 * server speaks the domain's language (GLOSSARY.md: Sweep, Receiving
 * Address, Provider Account); the dashboard shows withdrawals, payment
 * addresses and your NEAR account.
 */
export function inPlainWords(message: string): string {
  return message
    .replace(/(^|[.!?]\s+)Sweep(s?)\b/g, (_, start: string, s: string) => `${start}Withdrawal${s}`)
    .replace(/\bSweep(s?)\b/g, (_, s: string) => `withdrawal${s}`)
    .replace(/\bReceiving Address(es)?\b/g, (_, es?: string) => `payment address${es ?? ""}`)
    .replace(/\bProvider Account\b/g, "NEAR account")
    .replace(/\bThe MPC signature\b/g, "The approval")
    .replace(/\bMPC signature\b/g, "approval")
    .replace(/\bchain(s?)\b/g, (_, s: string) => `network${s}`);
}
