# Payments go to Chain Signatures Receiving Addresses; Herald is a library, not a proxy

The bridge-deposit design (ADR-0001, ADR-0002) put Herald's proxy in the payment path and forced a $0.15 minimum on Base. Instead, each Provider's NEAR account derives an ordinary address per chain through NEAR Chain Signatures (MPC contract `v1.signer`). That address is the `payTo` in the Provider's own stock x402 middleware, settled by stock facilitators. Payments of any size land natively on each chain, Herald never touches them, and the Provider's NEAR key is only needed to Sweep.

## Considered Options

- **Bridge Deposit Addresses into an Intents Account (ADR-0001)**: rejected. Deposit Minimums ($0.15 on Base), addresses that the bridge may change, and a Herald proxy in the payment path.
- **Plain wallets (one EVM key, one Solana key)**: rejected. The Provider manages one key per ecosystem with no NEAR-side control. With Chain Signatures, one NEAR account can rotate keys or be moved under a contract or multisig without changing any receiving address.
- **Herald holds the Provider's key, or derives every Provider's addresses from a Herald account**: rejected. Herald would have custody of every Provider's funds.

## Consequences

- Herald pins the MPC root public keys, so `accepts()` derives Receiving Addresses offline and makes no network calls (ADR-0005). The pinned keys are checked against the MPC contracts by the live test suite, and by the facilitator at startup, which refuses to settle on a mismatch. A root-key change would change every Receiving Address.
- A leaked NEAR key exposes the Provider's Receiving Addresses on every chain.
- Balances sit on several chains until a Sweep. Each Sweep costs one MPC signature (about $0.003) plus gas on the source chain.
- NEAR is a Payment Option too, first in each environment (NEAR on mainnet, NEAR Testnet on testnet). Its Receiving Address is the implicit account of the ed25519 key derived on path `near-1`, which Herald creates and registers on USDC at its own cost (ADR-0009).
