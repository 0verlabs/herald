# Herald: x402 gateway with NEAR Intents (report)

> **Superseded.** This report describes the bridge Deposit Address design (ADR-0001, ADR-0002). The current design uses Chain Signatures Receiving Addresses: see `docs/adr/0003` to `0006` and `GLOSSARY.md`. Sections 2 and 5 (feasibility and prior art) are still accurate.

Date: 2026-11-10. Sources: [x402.md](./x402.md), [near-intents.md](./near-intents.md), [prior-art.md](./prior-art.md). Every claim below is backed by a source in those files.

## 1. The idea as stated

A provider puts a paywalled API behind Herald. The 402 response lists many payment options (assets on many chains). The buyer pays with whatever it holds on its own chain. Value lands in the provider's NEAR Intents account. The provider sweeps to one chain and asset later.

## 2. Does it work?

The core idea works. The part that doesn't work is swapping on every request.

| Claim | Verdict | Why |
| --- | --- | --- |
| One 402 can list many chains and assets | Yes | `accepts[]` takes any number of entries, each with its own `network`, `asset`, `payTo`. |
| Value can land in a NEAR Intents account | Yes | 1Click supports `recipientType: INTENTS`. The PoA bridge also gives every Intents account a fixed deposit address on each chain. |
| Provider needs no NEAR account | Yes | An EVM address (lowercase) is a valid Intents account id, and the provider can sign withdrawals with MetaMask (ERC-191). |
| Provider can sweep later to one chain or asset | Yes | 1Click quote with `depositType: INTENTS` swaps and withdraws in one step, 7-17 s. Withdraw fee about $0.002 on Base or Arbitrum. |
| Swap per request through 1Click | **No** | Minimums are $0.15 on Base, $0.23 on Solana, $0.30 on Ethereum and about $6 on BTC. Settlement takes 20-45 s on L2s and Solana and about 13 min on BTC. x402 prices are $0.001-$1 and buyers expect the response in seconds. |
| "Any asset" for stock x402 buyers | Partly | Stock x402 clients only pay recognized USD stablecoins, capped at $1, unless the buyer opts in. The `exact` scheme only moves EIP-3009 or Permit2 tokens on EVM, SPL on Solana, and NEP-141 on NEAR. Native BTC or ETH can't be paid through `exact`. |

## 3. The better approach

Don't swap per payment. Take the stablecoin the buyer already has, on the buyer's chain, and deposit it straight into the provider's Intents account. Swap once, at sweep time.

How it works:

1. The provider gives Herald an upstream URL, a USD price per route, and an Intents account (for example their EVM address).
2. Herald asks the PoA bridge (`deposit_address` on `bridge.chaindefuser.com/rpc`) for the provider's fixed deposit address on each chain. These never change, so Herald caches them.
3. On an unpaid request, Herald returns a 402 with plain `exact` entries (USDC or USDT on Arbitrum, Polygon, Solana, Ethereum, Optimism, ...). Each entry's `payTo` is the provider's PoA deposit address on that chain.
4. The buyer's normal x402 client signs. A facilitator settles on that chain in 1-3 s. Herald proxies the request upstream and returns the response.
5. The PoA bridge sees the transfer and credits the provider's Intents balance. Herald never holds funds.
6. The provider's dashboard shows the Intents balance per token and has a "Sweep to Base USDC" (or any target) button backed by a 1Click quote.

Why this is better than the original framing:

- **It works with every existing x402 buyer.** No new scheme and no client plugin. That matches the target: providers who want more buyers.
- **No custody.** Funds go from the buyer straight to the provider's PoA address. Herald doesn't become a money transmitter.
- **Micropayments work.** The PoA minimum is $0.001 USDC on Arbitrum, Polygon, Ethereum and Solana, and there is no swap fee on the payment path.
- **It's simple to build.** It's a 402 builder plus a proxy plus a sweep button. Settlement reuses `@x402/*` packages and existing facilitators.

## 4. Risks and unknowns

Ranked by how much each can break V1:

1. **PoA crediting is untested for this use.** The bridge docs say its listener catches any ERC-20 `Transfer` to the deposit address. EIP-3009 `transferWithAuthorization` emits a standard `Transfer`, so it should work, but nobody has confirmed it. Behavior below the minimum is unknown (credited later, held, or lost). **Base's minimum is $0.15**, and Base is the main x402 chain. Mitigation: the Base lane points at the provider's own Base wallet (providers on x402 already have one). Herald adds every other chain into Intents. A $0.05 real-money test on Arbitrum and Base settles this, and it needs your approval.
   Update 2026-11-10 ([static-deposit-address.md](./static-deposit-address.md)): addresses were stable across three calls and one EVM address covers every EVM chain. Contract-sent transfers were credited in 3-4 s, and `recent_deposits` lets Herald confirm each credit by tx hash. Nothing promises the addresses are permanent, though: the frontend warns they may change, and Polygon, BNB and Avalanche are moving bridges. Herald must re-fetch them often. On Solana, the ATA must be pre-created or sponsored.
2. **Facilitator coverage per chain.** CDP covers Base, Solana and several EVM chains but needs API keys. Other chains may need a self-hosted facilitator built with `@x402/*`, with a small gas wallet per chain.
3. **Default client picks `accepts[0]`.** A buyer that registers `eip155:*` gets the first EVM entry even if its funds are on another chain. Mitigations: careful ordering, and a small buyer helper with a balance-aware selector.
4. **Competition.** The NEAR Intents team is standardizing per-request 1Click payments in x402 (PR #3370). Herald should not compete on that protocol. It should sell the provider-side product: one setup, every chain, one treasury, sweep anywhere.
5. **Standing balance in `intents.near`.** Any key authorized on the account can move the whole balance. That's acceptable for a provider's own key. Note it in the docs.
6. **Hackathon fact mismatch.** HACKATHON.md says the keyless 1Click fee is 0.2%. The docs say an extra 0.25%; dry quotes showed 0.20%. This only affects sweeps.

## 5. Has someone done this? Yes, partly

The per-request "x402 plus 1Click" path is already taken. Nobody combines "stock x402 buyers on any chain → provider's NEAR Intents account → sweep later".

Direct matches (any asset in, one asset out):

- **NEAR Intents `near-intents` method for x402**: spec PR [#3370](https://github.com/x402-foundation/x402/pull/3370), replacing [#2102](https://github.com/x402-foundation/x402/pull/2102). Written by a NEAR Intents team member, still open and changing.
- **Defuse `nearintents-mpp-sdk`**: the same flow for MPP (Stripe/Tempo) instead of x402. On npm.
- **x402_1CS_gateway** (IkerAlus): an x402 gateway over 1Click. Buyers pay with Base USDC; providers receive on any chain.
- **Solvador `multichain-exact`**: code over 1Click with one reported mainnet run. Not offered by Solvador's live facilitator.
- **AnySpend x402** (B3): live facilitator. Buyers pay with any permit token; providers receive USDC.
- **x402-cross-bridge-sdk** (divi2806): routes through Relay, settles to Base USDC.
- **Stableyard x402plus**: the buyer prefunds a USDC vault, then pays per call.
- **X402-Universal**: hackathon demo that batches payouts through Hyperbridge.
- **Smaller NEAR demos**: NEAR Intents x402 example (PR #123, May 2025), Anyone Pay, and the JustaLab demo.

Closest in shape: **Circle Gateway Nanopayments**. Sellers get credited in a ledger and withdraw to any chain, but it only handles USDC. Also **`intents-verifier`** (PR #2948), where the provider is credited inside `intents.near`, but only same-asset payers who already hold an Intents balance.

## 6. Proposed V1 (simplest version)

In scope:

- Hosted reverse proxy: `herald.xyz/p/<provider>/<path>` → the provider's upstream URL. The provider changes no code.
- Provider setup: upstream URL, USD price, Intents account (EVM address), optional own Base wallet.
- 402 builder: USDC `exact` entries on 4-6 chains, `payTo` = PoA deposit addresses, plus Base → provider wallet.
- Settlement through `@x402/*` with existing or self-hosted facilitators.
- Dashboard: Intents balances (`mt_batch_balance_of`), payment log, and a sweep button (1Click, signed with ERC-191).
- Demo: an agent with USDC on Arbitrum or Solana calls a Base-only API through Herald; the provider sweeps to Base.

Out of V1 (v2 candidates):

- **Pay from an Intents balance** (signed `transfer` intent as a new x402 scheme, verified with `simulate_intents`, batched `execute_intents`). This is the most NEAR-native lane, with sub-second settlement and any token held in Intents. It needs a buyer plugin.
- Volatile assets (ETH, SOL, BTC) through a one-time 1Click top-up into the buyer's Intents account.
- Herald fee: possibly 1Click `appFees` on sweeps.

Hackathon tracks that fit: `agents`, `business`, `realworld`, `defi`.

## 7. Next step

Step zero is a $0.05 real-money test: an EIP-3009 payment to a PoA deposit address on Arbitrum and on Base, both above and below the minimum. It needs your sign-off. If it passes, run `/grill-with-docs` on the V1 scope above.
