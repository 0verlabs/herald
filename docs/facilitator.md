# Facilitator

`apps/facilitator` serves the x402 v2 facilitator API on the stock `@x402/core` facilitator and `exact` mechanisms:

| Endpoint         | Auth                         | What it does                                                                                                                                                                          |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /supported` | none                         | Lists every network Herald has in its environment, Solana with Herald's fee payer, and Herald's NEAR relayer under `signers["near:*"]`.                                               |
| `POST /verify`   | `Authorization: Bearer hk_…` | Verifies a payment into the key's Provider's own Receiving Address. 120 requests per minute per key.                                                                                  |
| `POST /settle`   | `Authorization: Bearer hk_…` | Settles it with Herald paying gas, and records the payment. 60 requests per minute per key, counted before the body is checked. Refused if the MPC root keys don't match `v1.signer`. |

Refusals come back as `{ "error": "…", "message": "…" }` with 400, 401 (missing, unknown, revoked or wrong-environment key), 403 (`payTo` isn't the Provider's), 429 or 503. EVM transactions go through one `EvmChainQueue` Durable Object per network, which owns the gas wallet's nonce and never submits the same EIP-3009 authorization twice. It also keeps settlements whose receipt didn't arrive within `SETTLE_RECEIPT_TIMEOUT_MS` (30 s), so the stock resource server's single `settlement_pending` retry, on any isolate, waits for the same transaction instead of failing.

Solana payments settle with the stock `@x402/svm` `exact` mechanism. The Buyer signs a USDC transfer with Herald's gas wallet as fee payer, and one `SolanaChainQueue` Durable Object per network adds the fee payer's signature and sends it. It signs only as fee payer, never a transaction whose instructions use the gas wallet's account, and never sends the same transaction signature twice. A payment only lands in a Receiving Address that has a USDC token account, so the same queue creates one per Provider when it registers (paying the rent) and records the result on the Provider (`solana_token_account_status`: `not_queued`, `queued`, `created` or `failed`). The web Worker queues it through a cross-Worker Durable Object binding. Until it exists, `/verify` and `/settle` answer `invalid_exact_svm_recipient_ata_missing` and nothing is sent.

NEAR payments (NEAR on mainnet and NEAR Testnet, listed first in each environment; ADR-0009) settle with the stock `@x402/near` `exact` mechanism. The Buyer signs a NEP-366 delegate action holding one USDC `ft_transfer` into the Provider's NEAR Receiving Address (an implicit account derived on `near-1`, ADR-0009), and needs no NEAR. One `NearChainQueue` Durable Object per network holds the relayer key, wraps the delegate action in a relayer transaction with the next relayer nonce, sends it and waits until it is final (up to `SETTLE_RECEIPT_TIMEOUT_MS`), outside the nonce lock. It remembers every signed delegate action it was given, so presenting one again, from any isolate, is refused instead of relayed. The payment is recorded with the Buyer's NEAR account and the relayer transaction's hash. A Receiving Address must exist and be registered on USDC (`storage_deposit`) before payments into it pass `/verify`; until then they answer `invalid_exact_near_recipient_not_registered_for_storage`. Herald sets it up at its own cost: every sign-in of a Provider whose NEAR Receiving Address isn't set up yet (`near_setup_status` not `created`) queues a setup job on `NearChainQueue`, whose alarm sends two relayer transactions, each only if the chain doesn't show it done: a 0.002 NEAR transfer that creates the implicit account, and `storage_deposit` on USDC (0.00125 NEAR, `registration_only`). The facilitator's Cron Trigger (every 10 minutes, `triggers.crons` in its `wrangler.jsonc`) queues the setup of up to 50 Providers per run that are `not_queued`, so Providers registered before NEAR are set up without signing in again. A failed attempt is retried after 30 s, 1, 2, 5 and 10 min; after six the Provider goes back to `not_queued`, and the next scheduled run or sign-in queues it again. The facilitator never sets an account up while verifying or settling a payment. Home shows the status next to the NEAR address.

Facilitator secrets per environment:

| Secret                                               | What it is                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EVM_GAS_KEY`                                        | 0x hex private key, one gas wallet for every EVM chain.                                                                       |
| `SOLANA_GAS_KEY`                                     | base58 64-byte secret key, funded with SOL for fees and token account rent.                                                   |
| `BASE_RPC_URL`, `SOLANA_RPC_URL`, `ARBITRUM_RPC_URL` | JSON-RPC endpoint of each chain, for the environment's network (Base Sepolia, Solana Devnet and Arbitrum Sepolia on testnet). |
| `POLYGON_RPC_URL`, `AVALANCHE_RPC_URL`               | Mainnet only.                                                                                                                 |
| `NEAR_RPC_URL`                                       | NEAR testnet or mainnet, for the MPC root-key check and NEAR settlements.                                                     |
| `NEAR_RELAYER_KEY`                                   | `ed25519:` and a base58 64-byte secret key: the NEAR relayer, an implicit account. `scripts/near-relayer-wizard.sh` makes it. |

Every RPC endpoint is a private QuickNode URL, which carries the API key, so all of them are secrets. Solana's public endpoints wouldn't work anyway: `api.devnet.solana.com` and `api.mainnet-beta.solana.com` refuse requests from Workers (they block on the `CF-Worker` header, locally too). The web Worker needs `NEAR_RPC_URL` for sign-in and for reading Sweep signatures, and the same `<CHAIN>_RPC_URL` secrets as the facilitator for Home's live balances and for following Sweeps (EVM receipts; Solana blockhashes, accounts and signature statuses).

To get a Provider and an API key without the dashboard:

```bash
vp -C apps/facilitator run seed alice.testnet                # local D1
vp -C apps/facilitator run seed alice.testnet --env testnet  # herald-testnet D1
```

It prints the Provider's Receiving Addresses and an `hk_test_` key, once. Locally it also queues the Provider's Solana USDC token account, so run the facilitator first. On testnet the token account is queued at the Provider's first dashboard sign-in.
