# NEAR Intents feasibility study for the Herald x402 gateway

Status: research note, 2026-11-09. All live data below was collected on mainnet on 2026-11-09 around 19:30 UTC with read-only calls (dry quotes, RPC view calls, transaction lookups). Nothing was signed or sent.

## Product idea under test

An API provider puts a paywalled endpoint behind the Herald gateway. A buyer (often an AI agent) calls it and gets HTTP 402 listing many payment options across chains. The buyer pays with what it holds. Value is routed through NEAR Intents so the provider ends up credited, ideally as a balance inside the Verifier contract `intents.near` (NEP-245 multi-token ledger). The provider later sweeps to one chain and asset. Payments are $0.001 to $1, and the buyer expects the API response within seconds.

## Sources

Local skill (read first): `.agents/skills/near-intents/SKILL.md`, `references/concepts.md`, `rules/*.md`.

Primary sources checked:

- Docs index: <https://docs.near-intents.org/llms.txt>
- 1Click: [about](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api.md), [making a request](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md), [swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md), [signed intent execution](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md), [API keys](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md), [going live](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/going-live.md)
- OpenAPI spec v0.1.10: <https://1click.chaindefuser.com/docs/v0/openapi.yaml>
- Verifier: [intro](https://docs.near-intents.org/integration/verifier-contract/introduction.md), [account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md), [intent types](https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.md), [signing](https://docs.near-intents.org/integration/verifier-contract/signing-intents.md), [simulating](https://docs.near-intents.org/integration/verifier-contract/simulating-intents.md), [deposits](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md), [withdrawals](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md), [balances](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/balances.md)
- Message Bus: [overview](https://docs.near-intents.org/integration/market-makers/message-bus/introduction.md), [RPC](https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md)
- [Bridges](https://docs.near-intents.org/integration/bridging/overview.md), [chain support](https://docs.near-intents.org/resources/chain-support.md), [fees](https://docs.near-intents.org/resources/fees.md), [FAQ](https://docs.near-intents.org/resources/faqs.md), [risk & compliance](https://docs.near-intents.org/security-compliance/risk-and-compliance.md), [1Click terms](https://docs.near-intents.org/security-compliance/terms-of-service.md), [Intents SDK](https://docs.near-intents.org/integration/devkit/intents-sdk.md)
- Source code: <https://github.com/near/intents> at commit `32cd1f9` (2026-11-04); `@defuse-protocol/intents-sdk` 0.95.0 and `@defuse-protocol/internal-utils` 0.45.0 from npm
- x402: [spec repo](https://github.com/x402-foundation/x402), [`exact` on NEAR](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_near.md), [`batch-settlement`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md)
- NEAR timing: [Blocks and finality](https://docs.near.org/integrations/blocks-and-finality) (about 600 ms blocks, about 1.2 s finality)

Content from these sources is paraphrased.

### Corrections to the local skill and to the brief

| Claim | What the primary sources say |
| --- | --- |
| Skill: `depositType`, `recipientType`, `refundType`, `deadline`, `slippageTolerance` are optional with defaults | OpenAPI v0.1.10 lists all of them as **required** in `QuoteRequest`. Send them explicitly. |
| Skill: `quoteWaitingTimeMs` defaults to 3000 | OpenAPI says it defaults to **0 ms** (fastest quote). The live echo showed `quoteWaitingTimeMs: 0`. |
| Brief: "without JWT there's a 0.2% fee" | Docs ([fees](https://docs.near-intents.org/resources/fees.md), [API keys](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md)) say unauthenticated quotes pay an **extra 0.25%**. Observed dry quotes without a key behaved like the authenticated schedule instead: 1Click injected `appFees: [{fee: 20}]` (0.20%) on non-stable pairs, `fee: 1` (0.01%) on USDC to USDC across chains, and no fee on same-asset deposits. Wet quotes may differ; budget for 0.25% until tested. |
| Docs fees page: the 1-pip protocol fee applies to every transfer | In the contract source only `token_diff` charges the protocol fee, on the negative (token-in) side (`contracts/defuse/core/src/intents/token_diff.rs` lines 56-100). A plain `transfer` intent pays no protocol fee. Live `fee` view on `intents.near` returns `1` pip (0.0001%). |
| Skill: status polling needs a JWT | `GET /v0/status` answered without auth (404 for an unknown address), although the OpenAPI marks it with API-key security. |
| Signing: EIP-712 | Not supported. `MultiPayload` has exactly these variants: `nep413`, `erc191`, `tip191`, `raw_ed25519`, `webauthn`, `ton_connect`, `sep53` (`contracts/defuse/core/src/payload/multi.rs` lines 30-58). EVM wallets sign with ERC-191 `personal_sign`. BIP-322 (Bitcoin) is listed as in progress on the chain-support page and is absent from the source. |

Confirmed: there is no testnet, and the team has no plans for one ([FAQ](https://docs.near-intents.org/resources/faqs.md), [Verifier intro](https://docs.near-intents.org/integration/verifier-contract/introduction.md)). Only `dry: true` quotes are free to test.

---

## 1. 1Click quote, deposit, and status flow

Flow: `GET /v0/tokens` → `POST /v0/quote` (`dry: true` to preview) → `POST /v0/quote` (`dry: false` to get a deposit address) → buyer sends tokens on the origin chain → optional `POST /v0/deposit/submit` → poll `GET /v0/status` ([making a request](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md)). For balances already inside Intents, the deposit step is replaced by `POST /v0/generate-intent` → user signs → `POST /v0/submit-intent` ([signed intent execution](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md)).

Base URL `https://1click.chaindefuser.com`. Auth: partner JWT as `X-API-Key` (recommended) or `Authorization: Bearer`, from <https://partners.near-intents.org/>.

### `POST /v0/quote` request (OpenAPI `QuoteRequest`)

Required: `dry`, `swapType`, `slippageTolerance`, `originAsset`, `depositType`, `destinationAsset`, `amount`, `refundTo`, `refundType`, `recipient`, `recipientType`, `deadline`.

| Field | Values / meaning |
| --- | --- |
| `dry` | `true`: preview, response has no `depositAddress`, `timeWhenInactive` or `deadline`. `false`: commits and returns a deposit address. |
| `swapType` | `EXACT_INPUT`: fixed input. Under-deposit is refunded by the deadline; excess is processed and the surplus refunded. `EXACT_OUTPUT`: fixed output; slippage applies to input; response has `amountIn` (with buffer) and `minAmountIn`; below `minAmountIn` is refunded. `FLEX_INPUT`: any deposit ≥ `minAmountIn` is swapped as long as `minAmountOut` holds; not supported for confidential. `ANY_INPUT`: standing collector; `originAsset: "1cs_v1:any"`, `amount: "0"`; deposits in any token accumulate and are converted and withdrawn once the pool passes **$1,000**; no refunds; **authorized partners only**; `depositType` must be `INTENTS`/`CONFIDENTIAL_INTENTS` ([swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md)). |
| `originAsset`, `destinationAsset` | `assetId` from `/v0/tokens`, e.g. `nep141:base-0x8335…2913.omft.near`. |
| `amount` | Smallest units, read according to `swapType`. |
| `depositType` | `ORIGIN_CHAIN` (deposit address on the origin chain), `INTENTS` (an account inside `intents.near` that you fund with a signed transfer intent), `CONFIDENTIAL_INTENTS`. |
| `recipient` / `recipientType` | `DESTINATION_CHAIN` (address on the destination chain), `INTENTS` (account inside `intents.near`), `CONFIDENTIAL_INTENTS`. |
| `refundTo` / `refundType` | `ORIGIN_CHAIN`, `INTENTS`, `CONFIDENTIAL_INTENTS`. Must be valid for that type. Addresses were also screened: the `0x…dEaD` address was rejected as "refundTo is not valid". |
| `deadline` | ISO time when refund starts if not completed. It must leave room for the deposit to confirm; the spec notes Bitcoin can need about an hour. |
| `depositMode` | `SIMPLE` (default) or `MEMO` (Stellar and similar; the memo is then mandatory). |
| Optional | `quoteWaitingTimeMs` (default 0), `appFees` `[{recipient, fee_bps}]`, `referral`, `sessionId`, `connectedWallets`, `confidentiality` (`public`/`basic`/`advanced`), `insured` (+0.02%), `rebates`, `customRecipientMsg` (experimental `ft_transfer_call`; can lose funds), `virtualChainRecipient`, `virtualChainRefundRecipient`. |

### Quote response (`QuoteResponse` and `Quote`)

`correlationId`, `timestamp`, `signature` (1Click's ed25519 signature over the quote; keep it for disputes), `quoteRequest` (echo, including any injected `appFees`), and `quote`:

- `depositAddress` (wet only): origin-chain address for `ORIGIN_CHAIN`, or an account inside `intents.near` for `INTENTS`.
- `depositMemo`: must be included when present.
- `chainDepositAddresses`: only on public `ANY_INPUT` quotes.
- `amountIn`, `minAmountIn`, `amountOut`, `minAmountOut`, plus `*Formatted` and `*Usd` (USD is display only).
- `deadline`, `timeWhenInactive` (address goes "cold" and processing slows), `timeEstimate` (seconds after the deposit confirms).
- `refundFee` (origin-asset units) and `withdrawFee` (destination units, already deducted from `amountOut`).

Trimmed live dry quote, $1 Base USDC to Base USDC credited to an Intents account, no API key:

```json
{
  "quote": {"amountIn":"1000000","minAmountIn":"1000000","amountOut":"1000000","minAmountOut":"990000",
            "timeEstimate":35,"refundFee":"2400","withdrawFee":"0"},
  "quoteRequest": {"dry":true,"depositMode":"SIMPLE","swapType":"EXACT_INPUT","slippageTolerance":100,
                   "originAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
                   "depositType":"ORIGIN_CHAIN","destinationAsset":"(same)","recipient":"herald-provider.near",
                   "recipientType":"INTENTS","refundType":"ORIGIN_CHAIN","quoteWaitingTimeMs":0,"appFees":[]},
  "signature":"ed25519:49qk…", "correlationId":"7bc15f2d-…"
}
```

The $0.01 version of the same request returned HTTP 400: `{"message":"Amount is too low for bridge, try at least 150000"}`.

### `GET /v0/status?depositAddress=…[&depositMemo=…]`

Status values: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING` (in progress), and `SUCCESS`, `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED` (terminal). The response has `quoteResponse`, `updatedAt` and `swapDetails`: `intentHashes`, `nearTxHashes`, `originChainTxHashes`, `destinationChainTxHashes`, actual `amountIn`/`amountOut`, `slippage`, `depositedAmount`, `refundedAmount`, `refundReason`, `withdrawFee`. An unknown address returns 404 `Deposit address … not found`.

### `POST /v0/deposit/submit`

Body: `txHash`, `depositAddress` (required), `nearSenderAccount` (NEAR deposits), `memo` (MEMO mode). It is optional and only speeds up detection.

### Signed-intent path (`depositType: INTENTS`)

`POST /v0/generate-intent` with `{type:"swap_transfer", standard, signerId, depositAddress}` returns an unsigned `MultiPayload` (for a swap this is a `token_diff`). The user signs it unchanged, then `POST /v0/submit-intent` with `{type:"swap_transfer", signedData}` returns `intentHash`. Both endpoints need a partner key. Supported standards: `nep413`, `erc191`, `raw_ed25519`, `webauthn`, `ton_connect`, `sep53`, `tip191`. The unauthenticated probe of `generate-intent` returned HTTP 500 rather than 401.

## 2. Intents account as recipient, and origin-chain deposits

Yes to both. `recipientType: "INTENTS"` credits `recipient`'s balance inside `intents.near`, and `depositType: "ORIGIN_CHAIN"` (the normal flow) takes a plain transfer on the origin chain. Same-asset quotes (Base USDC to the Base USDC token inside Intents) are effectively bridge deposits. They showed no 1Click fee: `amountOut == amountIn` and empty `appFees`.

Recipient formats inside Intents, as validated by the live API:

| Owner | Intents account id | Result |
| --- | --- | --- |
| Named NEAR account | `provider.near` | accepted |
| EVM key (implicit Eth account) | lowercase `0x…` address | accepted. A checksummed (mixed-case) address was rejected as "recipient is not valid". |
| Solana / TON / other ed25519 key | 64-char hex of the public key | accepted. A base58 Solana address was rejected. |

Funds can be credited to a named account before it registers a key, but it must call `add_public_key` on `intents.near` before it can sign ([account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md)). Implicit accounts need no registration.

## 3. Minimums, fees, latency

### Live minimums (1Click dry quotes, `ORIGIN_CHAIN` → `INTENTS`, USDC)

| Origin | $0.001 | $0.01 | $0.10 | $1 | Min accepted | `refundFee` | `timeEstimate` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Base USDC | ✗ | ✗ | ✗ | ✓ | 0.15 USDC | 0.0024 | 35 s |
| Arbitrum USDC | ✗ | ✓ | ✓ | ✓ | 0.0053 | 0.0053 | 25 s |
| Polygon USDC | ✗ | ✓ | ✓ | ✓ | 0.0017 | 0.0017 | 35 s |
| Ethereum USDC | ✗ | ✗ | ✗ | ✓ | 0.30 | 0.30 | 45 s |
| Solana USDC | ✗ | ✗ | ✗ | ✓ | 0.23 | 0.23 | 20 s |
| NEAR USDC (`ft_transfer`) | untested | ✓ | untested | ✓ | ≤ 0.01 | 0.0045 | 20 s |
| Solana SOL | – | – | – | 0.01 SOL (≈$0.86) ✓ | unclear: an EXACT_OUTPUT $0.01 request said "try at least 86714" | 116238 lamports (≈$0.01) | 22 s |
| Bitcoin BTC | ✗ | ✗ | ✗ | ✗ | 8,300 sat (≈$6.2) | 1,900 sat | ≈805 s |

Pattern: the minimum is the larger of the bridge's minimum deposit and the refund cost on the origin chain. Base's $0.15 minimum matches the PoA bridge `min_deposit_amount` of 150000 (`supported_tokens` on `https://bridge.chaindefuser.com/rpc`).

Dry-quote round trip was 0.4-0.9 s with `quoteWaitingTimeMs: 0` and 3.4 s with 3000. `timeEstimate` counts from deposit confirmation, so the end-to-end time for one paid request is origin confirmation, plus detection, plus `timeEstimate`. That is about 25-45 s on L2s and Solana and about 13+ min on Bitcoin. Docs say to allow up to 15 minutes for cross-chain processing ([going live](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/going-live.md)).

### Fees (docs plus observed)

- Protocol: 1 pip (0.0001%) on `token_diff` only (live `fee` = 1).
- 1Click: docs say 20 bps with a key (1 bp for stablecoin or same-asset multichain routes) and an **extra 25 bps** without a key. `ANY_INPUT` is exempt. Observed without a key: 20 bps on USDC→wNEAR, SOL→USDC and BTC→USDC; 1 bp on USDC→USDC cross-chain; 0 on same-asset deposits ([fees](https://docs.near-intents.org/resources/fees.md)).
- Withdrawal fee (per sweep, from 1Click `withdrawFee` on `INTENTS` → `DESTINATION_CHAIN` $10 quotes): Base 0.0024, Polygon 0.0017, Arbitrum 0.0053, Ethereum 0.30, Solana 0.23 USDC. Estimates were 7-17 s. The PoA bridge `supported_tokens` list shows lower fees for some chains (Solana USDC 0.03). 1Click may route differently, so read the live quote.
- Extra 0.1% on NEAR, ZEC and STRK withdrawn to Solana.
- `appFees` lets Herald take its own cut. With a key, the default split is 50/50, with 1Click keeping at least 20 bps (1 bp on stable routes).

### Is $0.01 viable per request via 1Click?

No, except on Arbitrum, Polygon and NEAR, and even there 25-45 s of settlement time does not fit a request that must return within seconds. $1 payments clear minimums on the cheap chains but still take tens of seconds. Batching and prefunding are the way to support micropayments; see §4 and the verdict.

## 4. Signed intents from a balance already inside `intents.near`

### Mechanics

A `transfer` intent moves NEP-245 balances between Intents accounts:

```json
{"intent":"transfer","receiver_id":"provider.near","tokens":{"nep141:base-0x8335…2913.omft.near":"10000"},"memo":"x402:<payment-id>"}
```

It is wrapped in a payload `{signer_id, verifying_contract:"intents.near", deadline, nonce, intents:[…]}` and signed with one of the `MultiPayload` standards ([intent types](https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.md)). Other intent types: `add_public_key`, `remove_public_key`, `ft_withdraw`, `nft_withdraw`, `mt_withdraw`, `native_withdraw`, `storage_deposit`, `token_diff`, `set_auth_by_predecessor_id`, `auth_call` (source `core/src/intents/mod.rs` lines 42-82).

- **Nonce**: 32 bytes, base64, unique per account (unordered). The current format is versioned: magic prefix, salt (4 bytes, live `current_salt` = `252812b3`), nonce deadline (8 bytes LE ns), 15 random bytes ([defuse README](https://github.com/near/intents/tree/main/defuse#nonces)). The intent deadline must not exceed the nonce deadline. Replay protection is enforced on-chain.
- **Atomicity**: the intents inside one `execute_intents` call execute in order. Cross-contract effects such as withdrawals may finish out of order. `token_diff`s in a batch must net to zero per token.
- **Verify before settling**: `simulate_intents` is a view method with the same input as `execute_intents`. It checks signatures, nonces and balances without changing state ([simulating](https://docs.near-intents.org/integration/verifier-contract/simulating-intents.md)). A view call to `intents.near` on `rpc.mainnet.fastnear.com` took 80-100 ms.

### Signing with non-NEAR keys

Users do not need a NEAR account. The Verifier derives an implicit account from the signing key. ed25519 keys become 64-hex NEAR implicit ids; secp256k1/ECDSA keys become Eth-style `0x` addresses ([account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md)). Per standard ([signing](https://docs.near-intents.org/integration/verifier-contract/signing-intents.md)):

| Standard | Wallets | `signer_id` | Notes |
| --- | --- | --- | --- |
| `erc191` | MetaMask, any EVM wallet, viem local accounts | lowercase EVM address | `personal_sign` over the JSON payload string. No `public_key` field (recovered). `v` must be normalized to 0/1. Signature `secp256k1:<base58 65 bytes>`. **No EIP-712.** |
| `tip191` | TronLink | `0x` + 20-byte Tron address | Same as ERC-191. |
| `raw_ed25519` | Phantom, Solflare | hex of the Solana pubkey | `public_key: ed25519:<base58>`. |
| `nep413` | NEAR wallets | NEAR account | `recipient: intents.near` and nonce inside the NEP-413 envelope. |
| `webauthn` | Passkeys (P-256 or ed25519) | e.g. `0x…` derived id | Needs `client_data_json` and `authenticator_data`. Keys are uncompressed, signatures raw r‖s. |
| `ton_connect` | Tonkeeper etc. | 64-hex pubkey | TON sign-data `text` payload. |
| `sep53` | Freighter | hex of the raw 32-byte pubkey | Stellar. |

The SDK ships signer factories `createIntentSignerViem`, `createIntentSignerNEP413` and `createIntentSignerNearKeyPair` (`@defuse-protocol/intents-sdk` 0.95.0). An agent holding only an EVM private key can therefore pay from `intents.near` with viem and nothing else.

### Who submits `execute_intents`, and what it costs

`execute_intents(signed: Vec<MultiPayload>)` has no caller restriction, only a pause flag (`contracts/defuse/src/contract/intents/mod.rs` lines 26-42). Two ways to submit:

1. **Herald's own relayer**: any funded NEAR account calls `execute_intents` and pays gas. In the sample below, `escrow.ai.near` does exactly this.
2. **Solver relay (Message Bus)**: `publish_intent` / `publish_intents` at `https://solver-relay-v2.chaindefuser.com/rpc` (standards `nep413`, `erc191`, `raw_ed25519`). The relay submits and pays gas, and `get_status` reports `PENDING` → `TX_BROADCASTED` → `SETTLED` ([RPC](https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md)). Docs say a JWT is required. A read-only `get_status` worked without one. The Intents SDK publishes plain intents here with empty `quote_hashes` (`intent-relayer-public.js`).

Measured gas from 60 recent mainnet `execute_intents` transactions (nearblocks plus archival RPC; NEAR at $3.61 from `/v0/tokens`):

| Batch | Gas burnt | NEAR burnt | ≈ USD | Blocks touched |
| --- | --- | --- | --- | --- |
| 1 × `nep413` `transfer` (third-party caller) | 4.2 TGas | 0.00040 | $0.0015 | 2 |
| 1 × `nep413` `transfer` (relay, signer `intents.near`) | 5.7-6.1 TGas | 0.00055-0.00059 | $0.002 | 2 |
| 2 × `nep413` `transfer` in one tx | 8.0 TGas | 0.00078 | $0.0028 total (≈$0.0008 for the 2nd) | 2 |
| 1 × `erc191` `transfer` | 16.7 TGas | 0.00158 | $0.0057 | 4 |
| 1 × `nep413` `ft_withdraw` | 11 TGas | 0.00103 | $0.0037 | 4 |

Latency: a transfer touches 2 blocks. At about 600 ms per block and 1.2 s finality, settlement should take about 1.5-3 s from broadcast. This is an estimate; we did not submit a transaction to time it end to end.

Implications for micropayments: one transaction per $0.001 payment costs more in gas than the payment itself ($0.0015-0.006). Herald should verify each payment with `simulate_intents` (about 100 ms), serve the response, and settle many signed intents per `execute_intents` call. With about 2 TGas of marginal cost per extra `nep413` payload, tens of payloads fit within the per-transaction gas limit (a few hundred TGas; check the current protocol value). Fewer `erc191` payloads fit, and their marginal cost was not measured. Alternatively, Herald can push intents to the solver relay so the relay pays gas.

### As a new x402 scheme

x402 already has an `exact` scheme on NEAR. It uses a NEP-366 `SignedDelegateAction` for one `ft_transfer` and needs a real NEAR account and key ([spec](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_near.md)). A signed-intent scheme is new. It fits either as its own scheme (`near-intents`) or as a network binding of the existing [`batch-settlement`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/batch-settlement/scheme_batch_settlement.md) scheme. That scheme exists for cases where gas exceeds the payment value and lets settlement happen after access is granted, backed by prefunded capital. Sketch:

- `PaymentRequirements`: `{scheme:"near-intents", network:"near:mainnet", asset:"nep141:<token id>", amount, payTo:"<provider intents account>", maxTimeoutSeconds, extra:{verifyingContract:"intents.near", standards:["erc191","raw_ed25519","nep413","webauthn"]}}`. Offer one entry per accepted token id (Base USDC, Arbitrum USDC, NEAR USDC, USDT, …). The provider can hold any of them, so no swap is needed per request.
- Payload: one signed `MultiPayload` containing a single `transfer` to `payTo`, with `memo` bound to the x402 resource and payment id, a deadline near `maxTimeoutSeconds`, and a fresh versioned nonce.
- `/verify`: parse, check that the receiver, token and amount match, check the deadline, then `simulate_intents` (signature, nonce, balance). Keep a per-signer pending-spend ledger so concurrent intents cannot overspend before settlement.
- `/settle`: queue, then `execute_intents` with N payloads (or `publish_intents`). Return the intent hash, and later the tx hash.
- Buyer onboarding: a one-time top-up into the buyer's own implicit Intents account, e.g. 1Click `ORIGIN_CHAIN` → `INTENTS` with `recipient` = lowercase EVM address, or a PoA bridge deposit address (§5).

## 5. Deposit addresses, detection, refunds

- **1Click**: each wet quote gets its own deposit address ("quote-specific deposit address", [about](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api.md)). It is tied to the quote's terms and `deadline`, and goes cold at `timeWhenInactive`. Herald learns of arrival by polling `GET /v0/status` (the skill polls every 2 s), optionally after calling `/v0/deposit/submit` with the tx hash. `SUCCESS` arrives about `timeEstimate` seconds after the deposit confirms (20-45 s on L2s and Solana, about 13 min for BTC). The [Explorer API](https://docs.near-intents.org/integration/distribution-channels/1click-api/explorer/introduction.md) covers historical lookups.
- **Wrong amount**: `EXACT_INPUT` below `amountIn` is refunded at the deadline (status `INCOMPLETE_DEPOSIT`/`REFUNDED`), minus `refundFee`. Above `amountIn` the swap runs and the surplus is refunded. `EXACT_OUTPUT` refunds below `minAmountIn`. `FLEX_INPUT` accepts anything ≥ `minAmountIn`. `ANY_INPUT` never refunds. A $0.01 under-deposit on Base would cost $0.0024 to refund, and refunds go to `refundTo` on the origin chain.
- **PoA bridge persistent addresses**: `deposit_address` on `https://bridge.chaindefuser.com/rpc` returns a fixed per-account, per-chain address. For example `{"account_id":"0xd964…8d06","chain":"eth:8453"}` → `{"address":"0x614Fe2E9…5f14"}`. Deposits there credit that Intents account directly with no quote and no refund logic. The listener detects any ERC-20 `Transfer` event or native transfer to the address, including transfers from custom contracts ([FAQ](https://docs.near-intents.org/resources/faqs.md)). That should include EIP-3009 `transferWithAuthorization`, which x402 `exact` uses, but this is untested. Live PoA minimums: Base USDC 0.15, Arbitrum/Polygon/Ethereum/Solana USDC 0.001, BTC 0.00005. It is unknown what happens to deposits below the minimum (credited later, held, or lost); this must be tested with real dust before relying on it. Bitcoin dust such as 5,000 sat is swept with delays.

## 6. Withdrawals and sweeping

- **1Click from Intents**: quote with `depositType: INTENTS`, `originAsset` = the held token, `recipientType: DESTINATION_CHAIN`, `refundType: INTENTS`. Fund it by sending a signed transfer intent to the quote's `depositAddress`, or with `generate-intent`/`submit-intent`. This handles swap plus bridge in one step and can consolidate many token ids into one asset. Observed $10 quotes: Base 9.9976 out (fee 0.0024, 12 s), Arbitrum 9.9947 (9 s), Polygon 9.9983 (14 s), Solana 9.7696 (7 s), Ethereum 9.70 (17 s).
- **Direct withdraw**: the `ft_withdraw` / `mt_withdraw` / `nft_withdraw` / `native_withdraw` intents, or the direct calls `ft_withdraw` etc. on `intents.near` (1 yoctoNEAR, about 100 TGas). Intent token ids are unprefixed for withdraws. Omit `msg` so a failed `ft_transfer` is refunded; any `msg` string, even empty, switches to `ft_transfer_call` with no refund ([withdrawals](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md)).
- **PoA bridge to a foreign chain**: `ft_withdraw` with `token` = `receiver_id` = `<x>.omft.near` and `memo: "WITHDRAW_TO:<address>"` (from the SDK `poa-bridge-utils.js`). Fees come from `withdrawal_estimate` on the bridge RPC (Base USDC: 2400).
- **Omni / HOT bridges**: chosen by destination. Omni covers Ethereum, Base, Arbitrum, BNB, Solana and Bitcoin. HOT covers BNB, Polygon, Optimism, Avalanche, Scroll, Monad, TON, Stellar and others. PoA covers the widest set ([bridges](https://docs.near-intents.org/integration/bridging/overview.md)). `IntentsSDK.processWithdrawal` picks the route and estimates fees.
- **Fee aggregation**: `ANY_INPUT` sweeps many tokens into one asset but has a $1,000 threshold and is partner-only.

## 7. Limits and policy

- **Rate limits**: response headers show `x-ratelimit-limit-unauth: 1200` per 60 s on `/v0/tokens` and `/v0/quote`. Authenticated limits were not observed. The terms allow throttling (§2.8).
- **JWT / partner key**: needed for the authenticated fee schedule, `generate-intent`/`submit-intent`, `ANY_INPUT`, and (per docs) the solver relay.
- **KYC/KYB**: none for end users at the API level. The 1Click terms let Intents Technology run KYB on developers (§2.7). They oblige the developer to run KYC/AML and sanctions checks on its own end users where the law requires it (§4(f)-(g)), and say the service is not a money transmitter or custodian (§1). Non-dry quotes are screened against AML sources including TRM Labs ([risk & compliance](https://docs.near-intents.org/security-compliance/risk-and-compliance.md)). A Herald design that holds buyer funds (C) moves custody and compliance onto Herald.
- **Supported chains** (`/v0/tokens`: 216 tokens on 39 chain ids): abs, adi, aleo, aptos, arb, avax, base, bch, bera, bsc, btc, cardano, dash, doge, eth, fogo, gnosis, hood, hypercore, ltc, miden, monad, movement, near, op, plasma, pol, prl, qtc, scroll, sol, starknet, stellar, sui, ton, tron, xlayer, xrp, zec. Docs also list Aurora. Signing (paying from Intents) works for EVM, Solana, NEAR, TON, Tron, Stellar and passkeys. Bitcoin can deposit, but cannot sign intents yet.

---

## Verdict for the x402 gateway

| | A) Per-request 1Click swap into the provider's Intents account | B) Buyer prefunds Intents once, then pays per request with signed `transfer` intents (new scheme) | C) Standard x402 `exact` into gateway wallets, instant provider credit, batched settlement via Intents |
| --- | --- | --- | --- |
| Time to serve the request | 25-45 s (L2/SOL) after the buyer's tx, ≈13 min BTC. Serving after origin-chain confirmation (~2 s on Base) means trusting 1Click to deliver later. | ~0.1-0.3 s if served after `simulate_intents`; ~1.5-3 s if served after `execute_intents` finality | ~1-3 s (origin-chain `exact` settlement, e.g. Base); provider credit is a ledger entry |
| Minimum viable payment | Base $0.15, ETH $0.30, SOL $0.23, BTC ≈$6. Arbitrum $0.0053, Polygon $0.0017. Refund cost is $0.002-0.30. | Any amount (smallest units). Gas $0.0015-0.006 per tx, so batch and amortize. Top-up needs the chain minimum once. | Whatever the origin chain's `exact` facilitator supports (≈$0.001 on Base/Solana); batch settlement amortizes bridge minimums and withdraw fees |
| Buyer UX | Has to send an on-chain tx to a fresh address per call. Not standard x402. `refundTo` must be known when building the 402, so it would be Herald's address. | One-time top-up. After that, one off-chain signature per call (ERC-191, ed25519, passkey…). No gas and no NEAR account. Needs a client plugin for the new scheme. | Unchanged: any existing x402 client on Base/Solana/etc. works |
| Trust | 1Click/solvers and bridges; refunds go to `refundTo` | Verifier contract plus the bridge that issued the token. Buyer funds stay under the buyer's key until settled. Herald can only submit what the buyer signed. Between verify and settle, the provider is exposed to a double-spend race, which a pending-spend ledger and short deadlines limit. | Herald custodies buyer payments and owes providers. Highest compliance burden. Provider trusts Herald's ledger until settled. |
| Implementation effort (5 days left) | Low code (REST), but poor fit; needs wet-quote management per 402 | Medium: payload builder, verify via simulate, batch relayer (a NEAR account holding NEAR for gas), client SDK wrapper (viem signer exists), 1Click top-up flow | Medium-low for payments (reuse `exact` facilitators). Medium for treasury: wallets per chain, ledger, periodic PoA/1Click deposits and provider payouts. |
| NEAR-native story | Weak | Strong: new x402 scheme on `intents.near` | Moderate: Intents used for settlement only |

Conclusions:

1. **A is not viable as the per-request rail.** The minimums ($0.15+ on Base, Solana and Ethereum) and settlement times (tens of seconds) both miss the target. Keep 1Click as the **top-up and sweep** tool: buyer deposits from any chain into their own Intents account, and providers withdraw to one chain and asset.
2. **B is the best fit for micropayments and the most NEAR-specific.** It is technically supported today: implicit EVM and Solana accounts, ERC-191/ed25519/passkey signing, a permissionless `execute_intents`, `simulate_intents` for verification, and no protocol fee on `transfer`. The open risks are (a) gas per settle transaction relative to $0.001 payments, which needs batching or the solver relay, (b) optimistic serving before settlement, which needs a reservation ledger, and (c) buyers needing a new client scheme. Framing it as a `batch-settlement` network binding fits x402's own model for sub-cent payments.
3. **C maximizes compatibility** with existing x402 buyers. It is a good fallback lane, ideally implemented as `payTo` = the provider's PoA bridge deposit address, so funds land in the provider's Intents account without Herald custody. That variant is blocked on two untested points: Base's $0.15 PoA minimum (Arbitrum, Polygon and Solana are $0.001), and whether EIP-3009 transfers below the minimum are credited.

Recommended hackathon scope: build B as the headline scheme, with a 1Click top-up for buyers and a 1Click sweep for providers. Advertise C (`exact` on a low-minimum chain) alongside B in the same 402 `accepts[]` if time allows.

### Open questions to test with small real funds (needs the human's sign-off)

- Wet-quote fees without a partner key: is it 20 bps or 25 bps extra?
- End-to-end `execute_intents` latency and gas for batches of `erc191` payloads.
- Whether the solver relay accepts `publish_intents` for plain transfers without a JWT, and how long it takes to reach `SETTLED`.
- What the PoA bridge does with deposits below the minimum, and whether it detects EIP-3009 `transferWithAuthorization` transfers.

## Appendix: raw observations

Dry-quote matrix (no API key, slippage 100 bps, `recipient: herald-provider.near`, `recipientType: INTENTS` unless noted):

```text
baseUSDC->baseUSDC $0.01   ERR Amount is too low for bridge, try at least 150000
arbUSDC->arbUSDC   $0.01   in=0.01 out=0.01  t=25s refundFee=5300
polUSDC->polUSDC   $0.01   in=0.01 out=0.01  t=35s refundFee=1663
ethUSDC->ethUSDC   $0.01   ERR … at least 300001
solUSDC->solUSDC   $0.01   ERR … at least 230433
baseUSDC->nearUSDC $1      in=1.0 out=0.999798 t=35s appFees=[{fee:1}]
baseUSDC->wNEAR    $1      out=0.277317 wNEAR t=37s appFees=[{fee:20}]
EXACT_OUTPUT baseUSDC->nearUSDC $1  in=1.010224 minIn=1.000121 out=1.0
BTC->nearUSDC 10000 sat    out=7.4265 t=807s refundFee=1900 appFees=[{fee:20}]
BTC 15/1400 sat            ERR … at least 8300
INTENTS baseUSDC->INTENTS nearUSDC $0.01  out=0.009996 t=10s
SWEEP INTENTS nearUSDC->Base $10          out=9.996433 withdrawFee=2400 t=12s
recipient checksummed 0x…  ERR recipient is not valid
recipient Solana base58    ERR recipient is not valid
```

Solver relay `quote` (Base USDC → NEAR USDC): `exact_amount_in: "10000"` → `result: null` after 3.4 s. `"1000000"` → `amount_out: "996498"` after 2.6 s. 1Click still quoted the $0.01 INTENTS→INTENTS case, so small amounts may only clear through 1Click.

Live `intents.near` views: `fee` = `1`, `current_salt` = `"252812b3"`, `fee_collector` = `7066024d…7f05`.
