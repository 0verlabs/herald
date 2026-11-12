# Several MPC signs in one NEAR wallet approval

Status: live testnet check for #12, 2026-11-12. Run with `scripts/multisign-probe-wizard.sh` against a local Herald testnet dashboard and `@hot-labs/near-connect` 0.12.0.

## Method

A throwaway dashboard page sent 3 `sign` calls to `v1.signer-prod.testnet`, one per testnet source chain (Base Sepolia and Arbitrum Sepolia: ECDSA, domain 0; Solana Devnet: EdDSA, domain 1), at 50 Tgas and 1 yoctoNEAR each. Payloads were random, on the probe-only path `herald-multisign-probe`. It then read each transaction back over NEAR RPC and counted the MPC signatures in its receipts.

- **Shape A:** one transaction with 3 `sign` actions (`signAndSendTransaction`).
- **Shape B:** 3 transactions with one `sign` each, in one request (`signAndSendTransactions`).

A shape passes on a wallet when it showed one approval and all 3 signatures landed.

## Results

| Wallet | Shape A | Shape B |
|---|---|---|
| Meteor Wallet | ❌ error, 1 approval(s), 0/3 signatures: User closed the window before completing the action | ✅ 1 approval, 3/3 signatures |
| Intear Wallet | not tested | not tested |
| Nightly Wallet | not tested | not tested |
| WalletConnect | not tested | not tested |
| Ledger | not tested | not tested |

## Recommendation

Shape B works on every wallet tested (Meteor Wallet). Build "Sweep all" on `signAndSendTransactions`: one NEAR transaction per Sweep, so each keeps its own `near_tx_hash` and the current tracking applies unchanged.

## Raw results

- **Meteor Wallet, shape A** (1 approval prompt(s)): Wallet keep "publishing" no error status shown on ui
  - `wallet=meteor-wallet account=hrld.testnet shape=A outcome=error txs=0 signatures=0/3 hashes=- error=User closed the window before completing the action`
- **Meteor Wallet, shape B** (1 approval prompt(s))
  - `wallet=meteor-wallet account=hrld.testnet shape=B outcome=ok txs=3 signatures=3/3 hashes=AvHKiJqV8Jn5A53WsYu8xETBDq5LD2fPKTH4kD2839k9,7q5Hg2YNZqWPcyDCySwKtssvFTqrUk17H2dFaRpmQbrm,EJ5qgbU4mT5Dktj51U6U88wGSFzSqEM7hu7JdGJL3djY`
  - [AvHKiJqV8Jn5A53WsYu8xETBDq5LD2fPKTH4kD2839k9](https://testnet.nearblocks.io/txns/AvHKiJqV8Jn5A53WsYu8xETBDq5LD2fPKTH4kD2839k9)
  - [7q5Hg2YNZqWPcyDCySwKtssvFTqrUk17H2dFaRpmQbrm](https://testnet.nearblocks.io/txns/7q5Hg2YNZqWPcyDCySwKtssvFTqrUk17H2dFaRpmQbrm)
  - [EJ5qgbU4mT5Dktj51U6U88wGSFzSqEM7hu7JdGJL3djY](https://testnet.nearblocks.io/txns/EJ5qgbU4mT5Dktj51U6U88wGSFzSqEM7hu7JdGJL3djY)

## Shape A fails at the MPC network, not the wallet

Checked on 2026-11-12 without a wallet. A throwaway faucet account, `herald-msprobe-mwcku1r0.testnet`, signed transactions with near-api-js 7.4.0 and sent them to `v1.signer-prod.testnet` with the same arguments as the probe: random payloads, path `herald-multisign-probe`, 50 Tgas and 1 yoctoNEAR per call.

| `sign` actions in one transaction | Result |
|---|---|
| 1 | Signed in about 5 s ([Z4TDhSN8…](https://testnet.nearblocks.io/txns/Z4TDhSN8vKQ9X1kNTooJC8mhffyYfwLr9hoppMmRV5N)) |
| 2 | Both calls failed with "Request has timed out" after about 124 s ([Hx6sj9Yj…](https://testnet.nearblocks.io/txns/Hx6sj9YjqZMts9BRYK362eEobb3ZvXBS78RTn7o9rmcB)) |
| 3 | All 3 calls failed with "Request has timed out" after about 126 s ([HCc2U2eX…](https://testnet.nearblocks.io/txns/HCc2U2eXFCKvDWGfCEFYmpK163VPpJfYCQQ74iEp9q3e)) |

- **What happens.** The contract accepts every call. It takes the deposit, queues the request and yields, but no MPC node ever answers.
- **Why.** The node's indexer only reads a receipt that holds exactly one action. `try_extract_function_call_args` returns `None` when `actions.len() != 1` ([near/mpc `crates/node/src/indexer/handler.rs`](https://github.com/near/mpc/blob/main/crates/node/src/indexer/handler.rs), read at 2bccb88). So nodes never see a `sign` call that shares a transaction with another action.
- **Meteor's shape A result.** Meteor's wallet kept saying "publishing" and then reported "User closed the window" during the wallet run. That fits this timeout: Meteor wasn't at fault.
- **What still works.** A `sign` call that arrives in its own one-action receipt is indexed and answered. That covers a one-action transaction (shape B) and a cross-contract call from another contract.

**What this means for Herald.** Shape A can't work with any wallet, so build "Sweep all" on shape B (`signAndSendTransactions`). The fallback is one approval per chain. This overrides option B in [sweep-all.md](sweep-all.md).
