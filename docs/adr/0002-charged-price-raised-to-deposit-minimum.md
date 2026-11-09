---
status: superseded by ADR-0003
---

# Charged Price is raised to the Deposit Minimum per Payment Option

The bridge does not reliably credit deposits below its Deposit Minimum (0.15 USDC on Base, 0.001 on most other chains). So for each Payment Option, the Charged Price is the higher of the Listed Price and that Payment Option's Deposit Minimum. A $0.01 request therefore costs $0.01 on Arbitrum but $0.15 on Base. Deposit Minimums are stored as data per chain and token, not hard-coded.

## Considered Options

- **Send Base payments to the Provider's own Base wallet**: rejected for V1. It splits revenue across two places and needs a second Provider setting.
- **Drop Base**: rejected. Base carries about 81-83% of x402 value.
