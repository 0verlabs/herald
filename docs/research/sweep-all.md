# Sweep all: several chains, one wallet approval

Status: research note, 2026-11-12. Live data comes from read-only calls made on 2026-11-11 around 17:50 UTC: 1Click dry quotes with no API key, `GET /v0/tokens`, NEAR RPC view calls, and PoA bridge RPC reads. Nothing was signed or sent. Following the brief, this note ignores the wallet test comment on issue #12 and `docs/research/multisign-wallets.md`. Source text is paraphrased throughout.

Question (issue #12): can a Provider Sweep several chains at once with one NEAR wallet approval, and what is the simplest design that does it?

## Answer

- **1Click and NEAR Intents have no batch of swaps.** A 1Click quote covers one origin asset, one amount and one deposit address. `generate-intent` and `submit-intent` also take one quote each.
- **The Verifier batches what is already inside Intents.** One signed payload can hold many intents, and `execute_intents` takes many payloads. That only helps with balances already in `intents.near`. Getting USDC off each chain still needs one MPC signature per Receiving Address and chain.
- **The MPC signer has no batch method.** `sign` takes one payload. One NEAR transaction can still carry several `sign` calls, because a transaction is a list of actions, and the wallet signs the transaction once.
- **Recommendation:** "Sweep all" sends one NEAR transaction to `v1.signer` with one `sign` action per chain. The rest of the existing per-chain Sweep flow stays as it is.

## Sources

- Herald code (read 2026-11-12): `packages/core/src/server/sweeps.ts`, `one-click.ts`, `solana-sweeps.ts`, `packages/core/src/receiving-addresses.ts`, `apps/web/src/routes/_dashboard/sweep.tsx`, `apps/web/src/lib/near-wallet.ts`, `apps/facilitator/src/{evm,solana}-chain-queue.ts`.
- 1Click OpenAPI v0.1.10: <https://1click.chaindefuser.com/docs/v0/openapi.yaml> (fetched 2026-11-11, the same version as in [near-intents.md](near-intents.md)).
- NEAR Intents docs, from the index at <https://docs.near-intents.org/llms.txt>: [swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md), [signed intent execution](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution.md), [intent types and execution](https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.md), [account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md), [Message Bus RPC](https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md), [fees](https://docs.near-intents.org/resources/fees.md), [swap limits](https://docs.near-intents.org/resources/swap-limits.md), [fee config](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md).
- Verifier source: [near/intents @ fce0936](https://github.com/near/intents/tree/fce0936b1699e0591204ce152a78afc1c1338b35) (2026-11-10).
- Intents SDK: `@defuse-protocol/intents-sdk` 0.96.0 from npm (published 2026-11-10), `dist/src/sdk.js` and `.d.ts`.
- MPC signer: [near/mpc @ e691bdb](https://github.com/near/mpc/tree/e691bdb98d68dcf74653da58d043453a6318765f). This is the source that live `v1.signer` reports through `contract_source_metadata` (version 3.18.0).
- nearcore: [near/nearcore @ 9f88300](https://github.com/near/nearcore/tree/9f88300a66a52872b9432dde3287d11e42831e91), `runtime/runtime/src/{verifier,actions,function_call}.rs`, `core/primitives-core/src/account.rs`, `protocol-model/spec/runtime-execution.md`. Live `EXPERIMENTAL_protocol_config` on `rpc.mainnet.fastnear.com` reports protocol 88.
- Wallets: `@hot-labs/near-connect` 0.12.0 (installed, and the latest on npm), `build/types/index.d.ts`, plus its wallet manifest at `https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json`.
- Local skills: `.agents/skills/near-intents` (SKILL.md and rules), `near-dapp`, `near-kit`, `near-api-js`, `near-smart-contracts`.

## 1. How a Sweep works today (verified in code)

The brief's description is right, with these details:

- One Sweep covers one source network, one USDC amount and one destination (`planSweep`, `sweeps.ts:280`). The destination kind is `same_chain` (no 1Click), `cross_chain`, or `intents`. The two 1Click kinds are mainnet only.
- For the 1Click kinds, Herald asks for a wet `EXACT_INPUT` quote with an `ORIGIN_CHAIN` deposit, refunds to the source Receiving Address on the origin chain, and `INTENTS` or `DESTINATION_CHAIN` as the recipient type (`one-click.ts:185-200`, `sweeps.ts:560-570`).
- EVM: Herald builds an EIP-3009 `TransferWithAuthorization` hash. The EIP-712 domain includes the chain id (`sweeps.ts:1738-1760`). Every EVM chain shares one Receiving Address (path `ethereum-1`, `receiving-addresses.ts:42`), but each chain still needs its own signature.
- Solana: Herald builds an SPL `TransferChecked` transaction. Herald's Solana gas wallet is the fee payer and adds the second signature. If the recipient has no USDC token account, Herald creates one and pays the rent (`solana-sweeps.ts:102-152`, `sweeps.ts:747`).
- The wallet sends **one** transaction with **one** `FunctionCall` to `v1.signer.sign`: 50 Tgas and 1 yoctoNEAR (`sweep.tsx:319-345`, `sweeps.ts:140`, `signRequestFor` at `sweeps.ts:1765`).
- Herald reads the signature from the transaction's final `SuccessValue` (`readMpcSignature`, `sweeps.ts:1388-1414`). It checks the signature against the planned payload, then hands the signed transfer to the facilitator's `EvmChainQueue` or `SolanaChainQueue` Durable Object, which pays gas and broadcasts it (`sweeps.ts:1422`, `:1475`).
- `near_tx_hash` is unique per Sweep. A second Sweep that presents the same NEAR transaction is rejected (`completeSweep`, `sweeps.ts:897-925`).
- Herald submits at most 10 Sweeps per Provider in 24 hours (`SWEEP_DAILY_CAP`, `sweeps.ts:57`). A "Sweep all" over 5 chains uses half of that.

## 2. Does Intents or 1Click batch swaps?

| Surface | Batch? | Evidence |
| --- | --- | --- |
| `POST /v0/quote` | No | `QuoteRequest` has one `originAsset`, `destinationAsset` and `amount` (OpenAPI L1482-1742). Posting a JSON array returned HTTP 400 ("property 0 should not exist"). |
| `generate-intent` / `submit-intent` | No | The request takes one `depositAddress` (L1322-1347). `submit-intent` takes one `signedData` `MultiPayload` (L1348-1361). The only `type` is `swap_transfer` (L451-541). |
| `ANY_INPUT` | One quote, many chains, but not usable here | A public `ANY_INPUT` quote returns `chainDepositAddresses`: deposit addresses on every bridged chain, all funding one Intents account (L1833-1843). It is for authorized partners only, converts and withdraws only once the pool reaches **$1,000**, never refunds, and retries failed swaps every 5 minutes ([swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md), [fee config](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md)). Even with it, each Receiving Address still needs its own MPC-signed transfer. |
| `FLEX_INPUT` | No | It covers one token through one deposit address with a variable amount. The docs suggest it for sweeping a wallet whose balance is still changing ([swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types.md)). |
| Orders `/v0/orders` | No | A request creates one order, as a single JSON:API `data` object (OpenAPI L542-694). |
| User auth `/v0/auth/*`, `/v0/account/*` | Not relevant | A NEP-413 signature over an empty `intents` list returns a session token. The balance endpoint reports private (confidential) balances only. |
| `depositType` / `recipientType: INTENTS` | Indirectly | An `INTENTS` deposit address is an account inside `intents.near` that you transfer into (L1561). One signed payload can therefore fund several such quotes. See §4. |
| Verifier `execute_intents` | Yes, for Intents balances | It takes `Vec<MultiPayload>` (`contracts/defuse/src/intents.rs:12`), and each payload holds a list of intents (`core/src/intents/mod.rs:30-36`). They run in order. Any error rejects the whole call (`core/src/engine/mod.rs:32-83`, `src/contract/intents/mod.rs:26-42`). A `transfer` carries a map of tokens, and `mt_withdraw` carries a list of `token_ids` (`core/src/intents/tokens.rs:65-69`, `:334-339`). |
| `token_diff` | Yes, in principle | One diff may list several tokens, and diffs submitted together must net to zero per token ([intent types](https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution.md)). A solver relay quote, however, covers one asset pair (`quote` in [RPC](https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md)). |
| Solver relay `publish_intents` | Yes | It takes several `signed_datas`, and with `requote` it re-quotes and retries failed ones instead of failing the batch ([RPC](https://docs.near-intents.org/integration/market-makers/message-bus/rpc.md)). It needs a JWT. |
| Intents SDK | Yes, for withdrawals | `processWithdrawal` and `signAndSendWithdrawalIntent` accept an array of `WithdrawalParams`. The SDK builds one set of intents per withdrawal, flattens them into **one** payload, signs it once and publishes it (`sdk.js:354-445`, `sdk.d.ts:207-224`). Each withdrawal goes out through its token's own bridge. That spreads tokens back to their own chains; it does not gather them onto one. |

**Conclusion.** Intents can turn many held balances into one signature: one NEP-413 `signMessage` covering several transfers, swaps or withdrawals. It cannot pull USDC off several chains, because only the Receiving Address keys can sign those transfers, and those keys are reachable only through `v1.signer`.

## 3. Chain Signatures and wallets

- **No batch sign.** The MPC contract's `sign(request: SignRequestArgs)` takes one payload (`crates/contract/src/api/sign.rs:28`). It checks attached gas against `sign_call_gas_attachment_requirement_tera_gas` (15 Tgas live) and requires a 1 yoctoNEAR deposit (`api/common.rs:59-73`).
- **Several `sign` calls fit in one transaction.** A NEAR transaction is a list of actions sent to one receiver. The live limits are 1 PGas of prepaid gas per transaction (`max_total_prepaid_gas` = 10^15) and 100 actions per receipt. At Herald's 50 Tgas per call, that is 20 `sign` calls per transaction. This corrects [near-intents.md](near-intents.md), which assumed a few hundred Tgas.
- **The calls are submitted all or nothing.** If any action in a receipt fails, every state change in that receipt is rolled back (`protocol-model/spec/runtime-execution.md` step 9, line 101). If one `sign` call panics, for example on a bad payload, no request is queued. Herald builds the payloads itself, so this should not happen.
- **Each MPC request finishes on its own.** Each `sign` call yields, and later resumes in its own callback receipt (`return_signature_and_clean_state_on_success`, `sign.rs:199-219`). A timeout fails only that callback.
- **Only the last action's return value reaches the transaction.** nearcore ignores return data from non-last actions (`function_call.rs:282-287`). Herald's current reader, which takes the transaction's `SuccessValue`, would see only the last signature. Every signature still appears as its own callback receipt in `receipts_outcome` (inference from the yield/resume flow; to test).
- **Function-call keys cannot request signatures.** nearcore rejects a function-call key on any transaction with a deposit or with more than one action (`verifier.rs:384-402`). The same rule applies to meta-transactions (`DelegateActionAccessKeyError` in `actions.rs:652-666`).
  - `FunctionCallPermission` holds only a gas `allowance`, a receiver and method names. There is no deposit allowance (`account.rs:960-976`).
  - This settles open item 4 in [chain-signatures.md](chain-signatures.md): a function-call key cannot sign a `sign` call, even inside a delegate action.
  - The MPC README mentions "a function-call key with an explicit deposit allowance". nearcore has no such key.
- **Wallets.** near-connect's wallet interface has `signAndSendTransaction`, which takes one receiver and a list of actions. It also has `signAndSendTransactions`, which takes a list of transactions, and `signDelegateActions`, which signs NEP-366 meta-transactions for a relayer (`build/types/index.d.ts:90-114`, `:178-185`).
  - Every wallet in the live manifest declares `signAndSendTransaction` and `signAndSendTransactions`. HOT, Meteor, Intear, Ledger, NEAR Mobile and near-cli also declare `signDelegateActions`.
  - No NEP or library contract says how many prompts `signAndSendTransactions` shows. A single transaction is signed once by construction, so it always means one approval.

## 4. Options

### A. Today, once per chain

N separate Sweeps. That means N wallet approvals, N NEAR transactions and N MPC signatures. This is the fallback in issue #12.

### B. One transaction, one `sign` action per chain (recommended)

Plan one Sweep per chain with a balance at or above its minimum. Each Sweep gets its own payload and, where needed, its own 1Click quote. Then call `wallet.signAndSendTransaction({ receiverId: "v1.signer", actions: [sign₁ … signₙ] })` once. After that, each Sweep follows the existing per-chain flow from `awaiting_signature` onwards.

- Approvals: 1. NEAR transactions: 1. MPC signatures: N.
- Fees: the same as A. Each `sign` burns about 0.0008 NEAR (about $0.003 at $3.76) ([chain-signatures.md](chain-signatures.md)). Source-chain gas is Herald's, as today. The 1Click fees are those of the existing quotes (table below).
- Latency: the MPC requests run in parallel, measured at 4-10 s each ([chain-signatures.md](chain-signatures.md)). Then each chain takes 1Click's 22-37 s `timeEstimate`. Expect about 45 s for the whole set.
- Failure handling: submission is all or nothing. After that, each Sweep fails or refunds on its own (an expired quote, a reverted transfer, a 1Click refund). That is the partial-failure behaviour issue #12 asks for.
- Code changes:
  - Drop or relax the unique `near_tx_hash`, so N Sweeps can share one hash (`sweeps.ts:897-925`).
  - Read each signature from the callback receipts in `receipts_outcome` instead of the transaction status (`sweeps.ts:1388-1414`). Match each one to its Sweep by checking it against that Sweep's payload, as `submitEvmSweep` and `submitSolanaSweep` already do.
  - Add a "Sweep all" planner and button in the UI.
  - Planning, quotes, queues and 1Click tracking stay unchanged.
- Signing window: the shortest one governs. A Solana transaction must be signed within about 60-120 s of planning (`SOLANA_SWEEP_VALIDITY_SECONDS`), so the batch must be signed quickly.
- Custody: unchanged. Each signature still needs the Provider's full-access key.

**Variant B2: `signAndSendTransactions` with N one-action transactions.** This needs no schema change, because each Sweep keeps its own hash and today's reader works. But whether the wallet shows one prompt for N transactions is up to each wallet (§3). On Ledger it means N signatures.

**Variant B3: `signDelegateActions`.** The Provider signs one delegate action containing N `sign` actions, and a Herald relayer submits it and pays gas and the 1 yoctoNEAR deposits. The Provider then needs no NEAR for Sweeps. This needs a relayer and is supported by fewer wallets.

### C. Into Intents first, then one signed intent

Stage 1 is B with the `intents` destination for every chain, so it still needs N MPC signatures and one approval. Stage 2 is one NEP-413 `signMessage` over a payload of `transfer` intents, one per 1Click `depositType: INTENTS` quote, or a batch withdrawal through the SDK. That is a second approval.

- Approvals: 2 when the destination is a chain, 1 when the destination is Intents (that case is simply B).
- Fees: it saves (N−1) destination withdrawal fees only if the swaps and the final withdrawal are separate steps, and that adds a third signature. Otherwise each `INTENTS → DESTINATION_CHAIN` quote includes its own withdrawal. Withdrawals to Base cost 0.0024 USDC, so the saving there is negligible. To Solana, 1Click charges 0.227 USDC per Sweep, while a direct PoA withdrawal costs 0.03 (bridge `supported_tokens`). So C pays off only for Solana (or Ethereum) destinations.
- Persistent PoA deposit addresses for stage 1, instead of 1Click quotes, remove the quote deadline and the refund-fee floor. Live: `herald-provider.near` has deposit address `0xB040…cb69` on Base, Arbitrum, Polygon and Avalanche, and `6MUN…XwQN` on Solana. Minimum deposits are Base 0.15, Solana 0.001, Arbitrum/Polygon/Avalanche 0.001 USDC.
  - A fixed Solana address needs its USDC token-account rent (about 0.002 SOL, $0.17) only once. A fresh 1Click deposit address may need it on every Sweep (inference from `solana-sweeps.ts:130`).
  - Still untested ([near-intents.md](near-intents.md)): what PoA does with deposits below its minimum, and whether it detects EIP-3009 deposits.
- Other requirements: a named Provider Account must call `add_public_key` on `intents.near` once before it can sign intents ([account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md)). Herald also needs a NEP-413 payload builder (salted nonce, deadline), and a 1Click key for `submit-intent` or a relayer for `execute_intents`.
- Failure handling: stage 2 is atomic per `execute_intents` call. Stage 1 is the same as B.
- Custody: between the two stages, funds sit in `intents.near` as bridge tokens (`*.omft.near` / `*.omdep.near`). The Verifier and those bridges are then trusted.

### D. Receiving Addresses that pay straight into Intents

Using the Provider's PoA deposit address as `payTo` leaves nothing to Sweep per chain: one `signMessage` would consolidate everything. This is ADR-0001, which ADR-0003 replaced because of the 0.15 USDC per-payment minimum on Base, bridge addresses that can change, and a Herald proxy in the payment path. Nothing found here changes that decision.

### E. Delegated authority (no prompt per Sweep)

A function-call key cannot call `sign` (§3), so Herald cannot hold a "sweep key". The only working form is a sweeper contract **deployed on the Provider Account itself**. The predecessor is unchanged, so the Receiving Addresses stay the same.

- The contract method takes no deposit. The contract attaches the 1 yoctoNEAR from its own balance.
- The contract builds the EIP-3009 hash or the Solana message itself, and only for fixed destinations. Persistent PoA deposit addresses fit; fresh 1Click addresses don't.
- Herald holds a function-call key for that method, or relays a delegate action signed with it.
- Result: zero prompts. Herald could Sweep automatically into the Provider's Intents account, and the Provider signs only the final consolidation.
- Cost: a Rust contract that needs an audit. A bug there drains every Receiving Address, because the contract lives on the Provider's master account. Each Provider must deploy it (prior designs for this are in [chain-signatures.md](chain-signatures.md) §6).

### Other

- **EIP-7702 with `chain_id` 0.** One MPC signature could delegate the EVM Receiving Address on every EVM chain to a sweeper contract with a fixed destination. Receiving Addresses never send transactions, so their nonce is 0 everywhere. This is inference only: Herald's chains may not all support 7702, it covers EVM only, and it adds contract risk.
- **One quote per chain is required anyway.** Herald needs one quote per source chain in every option except D.

## 5. Comparison (4 source chains plus Base, $5 each, destination Base USDC)

Live dry quotes. The fee column is USDC lost per $5 Sweep, from `amountIn − amountOut`.

| Route | Arbitrum | Polygon | Avalanche | Solana | Notes |
| --- | --- | --- | --- | --- | --- |
| Direct 1Click `ORIGIN_CHAIN → DESTINATION_CHAIN` Base (B) | 0.00299 | 0.00341 | 0.00341 | 0.00287 | Includes the 0.0024 withdrawal fee and 1 bp. `timeEstimate` 22-37 s. |
| `ORIGIN_CHAIN → INTENTS` (C stage 1) | 0 | 0 | 0 | 0 | `timeEstimate` 20-35 s |
| `INTENTS → INTENTS` Base USDC (C stage 2 swap) | 0.00059 | 0.00101 | 0.00101 | 0.00048 | Then one 0.0024 withdrawal for the total, about 12 s |
| Same sources → Solana USDC via 1Click | 0.228 | 0.228 | 0.228 | n/a | 0.227 of it is the withdrawal fee; PoA charges 0.03 |
| 1Click `refundFee` (Herald caps it at 10% of the Sweep) | 0.0053 | 0.0100 | 0.0174 | 0.227 | So Herald's floor is 0.05 / 0.10 / 0.17 / **2.27** USDC |

Base itself is `same_chain` (no 1Click, no fee). The Base minimum is 0.15 USDC on every route. Below the destination's withdrawal fee, 1Click refuses the quote: a $0.10 Arbitrum → Solana quote answered "try at least 5301", although the amount was already 100000.

| | A today ×N | **B one tx, N `sign`** | B2 N txs | C Intents first | E sweeper contract |
| --- | --- | --- | --- | --- | --- |
| Wallet approvals | N | **1** | 1 to N, depending on the wallet | 2 (1 if the destination is Intents) | 0 per Sweep, plus one-time setup |
| NEAR txs / MPC signatures | N / N | **1 / N** | N / N | 1 + 1 intent tx / N | N / N, sent by Herald |
| Extra fees vs A | none | **none** | none | +intent gas; saves (N−1) withdrawal fees only with a third signature | contract storage and gas |
| Latency | sequential, per prompt | **about 45 s total** | about 45 s | about 45 s + second step | as B, no human |
| Partial failure | per Sweep | **per Sweep after submit**; submission all or nothing | per Sweep | per Sweep, then atomic stage 2 | per Sweep |
| Code change | none | **small**: shared hash, receipt parsing, planner + UI | smallest | medium: NEP-413, Intents flow, key registration | large: contract, audit, deploy |
| Custody change | none | **none** | none | funds sit in `intents.near` between stages | Herald can trigger Sweeps (fixed destinations); contract risk on the master account |

## 6. Skill and prior-note corrections

| Where | Claim | Primary source says |
| --- | --- | --- |
| `near-smart-contracts/rules/chain-signatures.md` | The MPC network has 8 nodes | Live `v1.signer`: 16 participants, threshold 11 ([chain-signatures.md](chain-signatures.md)) |
| `near-intents/rules/intents-balance.md` | Read balances with near-api-js `connect` / `keyStores` | near-api-js 7.4.0 (the repo's version) exports neither from `lib/index.d.ts`. The quote example also omits fields the OpenAPI requires. |
| `near-dapp/references/near-connect.md` | Feature list ends at `signInWithoutAddKey`, `testnet`, `mainnet` | near-connect 0.12.0 also has `signInAndSignMessage`, `signInWithFunctionCallKey`, `signDelegateActions` and `gasKeys` (`build/types/index.d.ts:129-142`) |
| `near-intents/rules/api-user-auth.md` | (correct) | The balance endpoint covers private balances only. Read public Intents balances with `mt_balance_of`. |
| `near-intents/rules/api-orders.md`, `api-any-input-withdrawals.md` | (correct) | Both match OpenAPI v0.1.10. Orders take one order per request. |
| MPC README | Function-call keys "with an explicit deposit allowance" can sign | nearcore has no deposit allowance (`account.rs:960-976`, `verifier.rs:384-402`) |
| [near-intents.md](near-intents.md) | The per-transaction gas limit is a few hundred Tgas | Live `max_total_prepaid_gas` is 1 PGas, with 100 actions per receipt |
| [chain-signatures.md](chain-signatures.md) open item 4 | Unverified whether a `sign`-limited function-call key can sign a delegate action carrying the deposit | It can't: `DelegateActionAccessKeyError::DepositWithFunctionCall` (`actions.rs:652-666`) |

## Recommendation

> **Update (2026-11-12): option B doesn't work.** Live testnet runs show that MPC nodes never answer a `sign` call that shares its transaction with another action. With 2 or 3 actions in one transaction, every call timed out. The node indexer skips receipts with more than one action. Use variant B2 (`signAndSendTransactions`) instead: it gave 1 approval and 3 of 3 signatures on Meteor. See [multisign-wallets.md](multisign-wallets.md).

Build **option B**: "Sweep all" plans one Sweep per chain whose balance clears its minimum, and sends one NEAR transaction to `v1.signer` with one `sign` action per Sweep.

- It is the only design here where one approval is guaranteed by the protocol rather than by wallet UI.
- It adds no fees and no custody change.
- It keeps the per-chain quotes, queues and status tracking, so partial failure works the way issue #12 asks.

**Main trade-off:** the N Sweeps share one NEAR transaction.

- Submission is all or nothing.
- Herald must drop the unique `near_tx_hash` rule and read each signature from the callback receipts instead of the transaction's final value.
- Every quote in the batch must be signed within the shortest window, which is Solana's 60-120 s blockhash window.

Add option C's second stage later, and only for Solana or Ethereum destinations, where combining the withdrawal saves about 0.2 USDC per extra chain. Option E is the path to zero prompts, but only if Herald is willing to ship and audit a contract on every Provider Account.

## Open questions (need a human, small real funds or testnet)

1. Do HOT, Meteor, Intear, MyNearWallet and Ledger sign one transaction to `v1.signer-prod.testnet` with 2-5 `sign` actions (each 50 Tgas and 1 yoctoNEAR), and how does each display it? Does Ledger have a limit on actions per transaction?
2. With N `sign` actions in one transaction, does every signature appear as its own `SuccessValue` in `receipts_outcome` from `tx` with `EXECUTED_OPTIMISTIC`? What is the transaction's final status when one MPC request times out?
3. For B2: which wallets show a single prompt for `signAndSendTransactions` with N transactions?
4. For C: does 1Click pick up a plain `transfer` intent, sent through Herald's own `execute_intents`, into its `INTENTS` deposit address? Does `submit-intent` accept a payload that funds several quotes?
5. For C with PoA stage 1: does the bridge credit EIP-3009 deposits, and what happens to deposits below the minimum? (Carried over from [near-intents.md](near-intents.md).)
