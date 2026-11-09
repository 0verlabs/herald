---
status: superseded by ADR-0003
---

# Payments go to static Deposit Addresses, with no swap per payment

Every other NEAR Intents x402 design (x402 PR #3370, the Defuse `nearintents-mpp-sdk`, Solvador `multichain-exact`, x402_1CS_gateway) creates a 1Click quote and a new deposit address for each payment. That brings swap minimums ($0.15-$6), 20-45 s settlement and a client that must support a new payment method. Herald puts the Provider's fixed bridge Deposit Address for each chain into a plain x402 `exact` Payment Option. Buyers pay with any stock x402 client, settlement takes 1-3 s, and Herald never holds funds. Conversion to one asset happens once, at Sweep time.

## Considered Options

- **1Click quote per payment**: rejected because of the minimums, latency, custom client support and refund handling it needs.
- **Herald-held wallets with batched settlement**: rejected because Herald would hold Buyer funds and take on custody and compliance duties.
- **New signed-intent scheme paying from a Buyer's Intents balance**: deferred. It is fast and NEAR-native, but Buyers would need a new client and a prefunded balance.

## Consequences

- Herald depends on bridge Deposit Addresses that are not guaranteed permanent. It must re-check them and stop offering a chain whose address changes.
- Each chain's Deposit Minimum applies to every payment (see ADR-0002).
- The Provider holds whatever stablecoins Buyers paid until it Sweeps.
