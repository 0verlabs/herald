# Sweep all: one NEAR transaction per Sweep, sent in one wallet request

"Sweep all" plans one Sweep per chain holding at least its minimum. Each Sweep gets its own NEAR transaction carrying exactly one `sign` call to the MPC signer. The dashboard sends them all with near-connect's `signAndSendTransactions`, which Meteor Wallet approved with a single prompt. A wallet that doesn't declare `signAndSendTransactions` gets one approval per chain, Solana's first, because its transaction expires within about a minute. Each Sweep keeps its own `near_tx_hash` and completes on its own, so one chain failing leaves the others going.

## Considered Options

- **One transaction with one `sign` action per chain**: rejected. It would always mean one approval, but testnet MPC nodes never answered it: with 2 or 3 actions, every call timed out after about 125 s. The node indexer only reads receipts holding a single action (`try_extract_function_call_args` in near/mpc `crates/node/src/indexer/handler.rs`). It would also have needed Sweeps to share a hash and signatures to be read from receipts. See `docs/research/multisign-wallets.md`.
- **A batch-signing contract**: rejected for now. A shared Herald contract would become the `sign` caller, so it would change every Receiving Address and hold custody of them. A contract on each Provider Account keeps the addresses but needs an audit and a deploy per Provider.

## Consequences

- How many prompts the Provider sees depends on the wallet. Herald guarantees one NEAR transaction per Sweep, not one approval.
- Every Sweep in a Sweep all counts against the daily cap. The chains that don't fit are skipped with the reason.
