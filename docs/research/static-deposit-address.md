# Can a static NEAR Intents deposit address be the x402 `payTo`?

Status: research note, 2026-11-09, live calls 20:07-20:25 UTC on mainnet. Everything was read-only: JSON-RPC and REST reads, explorer lookups, source reading. Nothing was signed or sent.

Builds on [near-intents.md](./near-intents.md) §5 and [prior-art.md](./prior-art.md).

## Verdict

**Yes, with conditions.** A provider's bridge deposit address can be used as `payTo` in standard x402 `exact` offers. The design fits x402: `payTo` is normally a fixed merchant wallet, and with EIP-3009, Permit2 or SVM the payer's signature binds each payment to its request. The per-request addresses in PR #3370 and the Defuse MPP SDK come from two things Herald does not use: a 1Click swap quote, and a client-broadcast tx-hash proof.

What holds up, verified live:

- `deposit_address(account_id, chain)` is deterministic. It returned the same address for 12 chains when called three times over about 10 minutes. One EVM address covers every EVM chain. Different accounts get different addresses.
- Deposits are detected by a listener. No notify call is needed. Contract-originated transfers were credited 1:1 with no deposit fee: a LI.FI router call and an ERC-4337 smart-account call. On Base the credit landed on NEAR 3-4 s after the origin block.
- `recent_deposits` reports each credit with the origin `tx_hash`, the NEAR `mint_tx_hash`, the sender address and the amount. Herald can match each x402 settlement tx hash against it.

Conditions before relying on it:

1. **No permanence guarantee.** The official frontend warns the address "may change without notice". Bridges are being migrated right now: Polygon, BNB and Avalanche moved to Omni token IDs today, and Solana USDC deposits already go through Omni. Herald should fetch the address for each `(provider, chain)` regularly and stop offering a chain if the address changes.
2. **Minimums.** Base USDC has a minimum deposit of 0.15 USDC. Arbitrum, Ethereum, Solana and Polygon USDC have 0.001. What happens to a deposit below the minimum is undocumented.
3. **Solana ATA.** x402 SVM pays into the ATA of `payTo`. A fresh deposit address has no USDC ATA. Either the provider pre-creates it once, or the facilitator must support `ataCreationSponsored`.
4. **Wrong token or chain is lost.** Only tokens listed in `supported_tokens` for that chain are credited.
5. **EIP-3009 specifically has not been observed.** It is a strong inference from the FAQ and from the contract-originated credits above. It needs one real-money test.

---

## 1. Static-ness

### Verified (live)

`POST https://bridge.chaindefuser.com/rpc`, method `deposit_address`, params `[{account_id, chain}]`. Chain ids come from `supported_tokens` (`defuse_asset_identifier` prefix): `eth:1`, `eth:8453`, `eth:42161`, `eth:137`, `eth:10`, `eth:56`, `eth:43114`, `sol:mainnet`, `btc:mainnet`, `near:mainnet`, `tron:mainnet`, `ton:mainnet`, and others (38 chain ids in total).

| Account | Chain(s) | Address | Run 1 (20:10) | Run 2 (20:14) | Run 3 (20:20) |
| --- | --- | --- | --- | --- | --- |
| `herald-test.near` | eth:1, 8453, 42161, 137, 10, 56, 43114 | `0xa16d4873c23FF827b7aF33914b696199e3c35D23` | ✓ | same | same |
| `herald-test.near` | sol:mainnet | `NPyGV1D3uo4M948otwPZ9E7Ax8VfuYm6A8KwF8uuTzs` | ✓ | same | same |
| `herald-test.near` | btc:mainnet | `bc1qmml5ktqn2jtrcvku6t6afmd9lasp40s8xgwfsy` | ✓ | same | same |
| `herald-test.near` | near:mainnet | `bc3f796c…e56519` (64-hex implicit) | ✓ | same | same |
| `herald-test.near` | tron:mainnet | `TQgscX1qJMAMbtsgUedZ95otcEyzr8FoSy` | ✓ | same | same |
| `herald-test.near` | ton:mainnet | `UQAUaopxGLPYdZDdfzvuf-YMKfK6mIexff5cLL5noxZZ_Wf6` | ✓ | same | same |
| `herald-test2.near` | EVM / SOL | `0x64Ca1771…4Ff2` / `Fy3rs9bh…pG8` | ✓ | same | – |
| `herald-provider.near` | EVM / SOL | `0xB040e2c8…cb69` / `6MUNa9hV…XwQN` | ✓ | same | – |
| `0x1234567890abcdef…345678` | EVM / SOL | `0x885BC6ba…508b` / `ByLibfxZ…SyGc` | ✓ | same | – |

Other observations:

- **One address for all EVM chains.** This includes chains served by different bridges: PoA (Base, Arbitrum, Ethereum), HOT (Optimism) and the chains now moving to Omni (Polygon, BNB, Avalanche).
- **Different accounts get different addresses.** Five accounts were tested.
- **EVM account ids are case-normalized.** The checksummed form of `0x1234…5678` returned the same address as the lowercase form.
- **`0x000000000000000000000000000000000000dead` and `0x…0001` were rejected** with `"Invalid Account ID"`. Ordinary 0x addresses were accepted. The rejection rule is not documented; it looks like a blocklist of burn and precompile addresses.
- **The account does not have to exist.** `nonexistent-zzzz-qq.near` got an address. A typo in a provider's account id would therefore still produce a working address, crediting the wrong account. Herald must validate provider account ids itself.
- **Deposit addresses are EOAs.** `eth_getCode` on Base returned `0x` for `0x538c…C1FA` and `0xa16d…5D23`. The bridge holds the keys and sweeps funds out.

### Asset binding (verified, undocumented)

1Click's per-quote deposit addresses are bridge deposit addresses of fresh per-quote 64-hex Intents accounts, bound to one asset. Calling `deposit_address` for such an account returns an error:

```json
{"error":"deposit address 0x538c0687537BcE4B58F5b9DfCaF772ac523AC1FA is already bound to asset 'eth:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' and cannot be reused for 'none'"}
```

The same happened for two more Base addresses and a Solana address. Two conclusions follow. First, a 1Click "quote-specific deposit address" is a bridge deposit address of a per-quote Intents account. Second, the bridge supports binding an address to one asset, which 1Click uses. Addresses requested for ordinary accounts are unbound ("none").

Related failure: [near/intents#382](https://github.com/near/intents/issues/382) reports ETH sent on Base to a 1Click address issued for ETH on Ethereum. It was not credited, and the funds sit unspent at the address. That is a bound address. Herald's provider addresses are unbound, so the same address should work on every supported EVM chain. This is an inference and is untested.

### What the docs and code say about permanence

- **No explicit permanence statement** for the PoA/HOT/Omni deposit service exists in docs.near-intents.org (FAQ, bridges overview, deposits, changelog, treasury addresses) or in the SDKs.
- **Omni BTC is deterministic by design.** The address is calculated from the bridge's public key and the request, so the same request gives the same address and changing one character gives a different one ([how it works](https://docs.near-intents.org/learn/omni-bridge/how-it-works.md)).
- **Official frontend: one address per user per chain, with a warning.** `generateDepositAddress(userAddress, chain)` calls `poaBridge.httpClient.getDepositAddress({account_id, chain})` for every chain ([depositService.ts](https://github.com/defuse-protocol/defuse-frontend/blob/594085d3c7e60ce912fb62b768b12f46c4917510/src/components/DefuseSDK/services/depositService.ts)). The passive-deposit screen shows a QR code and the text "Always double-check your deposit address — it may change without notice." It also warns that depositing other assets or using another network results in loss of funds ([PassiveDeposit.tsx](https://github.com/defuse-protocol/defuse-frontend/blob/594085d3c7e60ce912fb62b768b12f46c4917510/src/components/DefuseSDK/features/deposit/components/DepositForm/PassiveDeposit.tsx), [renderDepositHint.tsx](https://github.com/defuse-protocol/defuse-frontend/blob/594085d3c7e60ce912fb62b768b12f46c4917510/src/components/DefuseSDK/features/deposit/components/DepositForm/renderDepositHint.tsx)).
- **A third-party production app treats the address as stable.** Trezu (NEAR-DevHub treasury) caches the bridge address with a long-term TTL, noting "the address is stable for that treasury+chain (same as near.com)". It tracks credits with `recent_deposits` ([deposit_address.rs](https://github.com/NEAR-DevHub/trezu/blob/main/nt-be/src/handlers/intents/deposit_address.rs), [bridge.rs](https://github.com/NEAR-DevHub/trezu/blob/main/nt-be/src/handlers/intents/deposit_tracker/bridge.rs)).
- **Bridge migrations are happening.** The [2026-11-09 changelog](https://docs.near-intents.org/changelog/entries/2026-11-09-evm-omni-token-ids.md) moves BNB, Polygon and Avalanche tokens from HOT `nep245:v2_1.omni.hot.tg:…` ids to Omni `nep141:….omdep.near`. Live `supported_tokens` still lists Polygon USDC under the HOT id, so the migration is in progress. Solana USDC deposits are now minted through `omni.bridge.near` (Wormhole-based sweep, see §2), while the token is still `sol-5ce3….omft.near`. The bridges overview lists Ethereum, Base, Arbitrum and Solana under both PoA and Omni ([bridges](https://docs.near-intents.org/integration/bridging/overview.md)).

**Inference:** today the address is a deterministic function of `(account, chain family)`, and in this window it survived an active bridge migration. A future migration could still change it, and the frontend reserves that right. Herald should treat the address as a cached value with a TTL, not as a constant. Re-fetch it before building each 402 (one cached RPC call) or on a short schedule, and alert if it changes.

## 2. Crediting mechanics

### Detection: listener, no notify (verified in docs and on-chain)

- **FAQ:** listeners watch EVM chains for ERC-20 `Transfer` events and native or internal transfers to any deposit address. A deposit is detected even when it comes from a custom contract method, as long as a valid `Transfer` event is emitted ([FAQ](https://docs.near-intents.org/resources/faqs.md)). The FAQ also says that once the deposit address balance becomes positive, the indexer creates a `PENDING` deposit, then collects the tokens, ending in `COMPLETED` or `FAILED`. `FAILED` deposits are handled manually.
- **There is no `notify_deposit` or submit method on the bridge RPC.** The SDK exposes exactly `supported_tokens`, `deposit_address`, `recent_deposits`, `withdrawal_status`, `withdrawal_estimate`, `hot_omni_withdraw` and a `/console/tokenBalances` GET (`@defuse-protocol/internal-utils` 0.45.0, `dist/poaBridge/poaBridgeHttpClient/apis.js`). Only 1Click has `/v0/deposit/submit`, and it is optional.

### `recent_deposits` (verified live)

Request `[{account_id, chain?, status?, limit?, offset?}]`. Status values in SDK types: `COMPLETED | PENDING | FAILED | CREDITED`. Accounts found from recent PoA mints on nearblocks:

```json
{"tx_hash":"0x7286f262…0ba2","mint_tx_hash":"A25ktawhzV1hchprMjioC6rvsEugEkZaP5KC7fRk5WT9","chain":"eth:8453",
 "defuse_asset_identifier":"eth:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
 "near_token_id":"base-0x8335…2913.omft.near","decimals":6,"amount":9965000,
 "account_id":"944c75b0…d191","address":"0x538c0687537BcE4B58F5b9DfCaF772ac523AC1FA",
 "status":"COMPLETED","created_at":"2026-11-09T20:10:42.601Z","from":"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"}
```

`herald-test.near` returned `{"deposits":[],"total":0,"hasMore":false}`. The FAQ says `tx_hash` is empty for Solana deposits, but the Solana deposit observed below did include it, so that FAQ entry may be out of date.

### Contract-originated transfers (verified on-chain)

| Origin tx (Base) | How the USDC reached the deposit address | Sent | Credited in `intents.near` | Origin block → NEAR mint |
| --- | --- | --- | --- | --- |
| `0x7286f262…0ba2` | tx `to` = `0x7813…4ada`. USDC moved user → LI.FI Diamond `0x1231DEB6…4EaE`, which took fees and then called `transfer` to `0x538c…C1FA` | 9,965,000 | 9,965,000 (`ft_on_transfer` amount) | 20:10:42 → 20:10:45 |
| `0x4d3471a7…99bb` | ERC-4337 EntryPoint v0.6 `0x5FF1…2789` executing smart account `0x2916…bD6c` → `0x9BCc…4080` | 100,000,000 | 100,000,000 | 20:07:39 → 20:07:43 |

In both cases the bridge credited the `Transfer` log, not the top-level tx sender. That is the same mechanism EIP-3009 `transferWithAuthorization` and the x402 Permit2 proxy rely on: each emits a standard `Transfer(from=payer, to=payTo)` from the token contract, inside a tx sent by the facilitator. **Inference (strong):** EIP-3009 and Permit2 x402 settlements will be credited. **Not observed:** a deposit carrying an `AuthorizationUsed` log. I tried scanning Base logs, but public RPCs refused the ranges needed.

### Fees and minimums

- **No per-deposit fee.** Credited amount equalled the transferred amount in all three observed deposits (two Base, one Solana). The [fees page](https://docs.near-intents.org/resources/fees.md) lists no deposit fee; it lists withdrawal fees only.
- **Minimums** (`min_deposit_amount`, live `supported_tokens`): Base USDC 150000 (0.15). Arbitrum, Ethereum, Gnosis and Solana USDC 1000 (0.001). Polygon, Optimism and Avalanche USDC also 0.001 (1000 at 6 decimals). BNB USDC is 0.001 too (1e15 at 18 decimals).
- **Below the minimum: unknown.** No doc, SDK code or GitHub issue says what happens. The frontend only displays "Minimum deposit". Two sources hint that a small deposit may sit at the address until the balance is large enough, but neither proves it: the FAQ's "when the balance … becomes positive" wording, and its note that BTC dust gets special handling and delays. **Unverified.**

### Solana (verified on-chain)

Deposit `BEAq63Y6…boap` (blockTime 20:16:18, `recent_deposits.created_at` 20:16:19):

- The sender's tx included `AssociatedTokenAccount.createIdempotent` for the deposit address `HrwZSfRQ…VKm` and USDC, then an SPL `transfer` of 37,010,850 to that ATA (`Fd3JkRR6…jW1`). The deposit address had no ATA before.
- The bridge swept it in the next slot (tx `2D4Qsbj…`, fee payer `9WL2A89Y…`, program `dahPEoZG…` plus Wormhole). `omni.bridge.near` then credited 37,010,850 to the account in `intents.near` (receipt `1jXqMeKb…`).
- The ATA **still exists** after the sweep, with balance 0. Later deposits to the same address would not need to create it again.
- The official frontend checks whether the deposit address's ATA exists and adds a `createAssociatedTokenAccount` instruction if it does not (`checkSolanaATARequired`, `createSPLTransferSolanaTransaction` in depositService.ts).
- `NPyGV1D3…` (`herald-test.near`) and `6MUNa9hV…` (`herald-provider.near`) have **no** USDC token account yet.

Implication for x402 SVM `exact`: the transfer must go to the ATA derived from `payTo` and `asset`. The fee payer may fund ATA creation only when the payment requirement sets `extra.ataCreationRequired` and the sponsor advertises `ataCreationSponsored` ([scheme_exact_svm.md](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md) §2.1.1, §5.4). Herald's options are to pre-create the provider's ATA once (one small tx costing roughly 0.0015-0.002 SOL of rent, needing the human's sign-off) or to use a facilitator that sponsors ATA creation.

## 3. Why prior designs use per-request addresses

All three designs use **1Click swap quotes**. In 1Click, each wet quote gets a fresh Intents account, and its bridge address is bound to one asset (see §1). The address is a by-product of the quote. Their stated reasons:

| Reason | Source |
| --- | --- |
| The address belongs to one quote. Its terms are the merchant destination, origin asset, deadline, `amountIn`/`minAmountIn` (EXACT_OUTPUT) and refund address. The backend runs at most one swap per address. | PR #2102 spec, "Replay Prevention": each quote's unique `depositAddress` acts as a natural nonce. MPP spec: each address corresponds to exactly one quote and is single-use. |
| **Request binding for tx-hash proofs.** The client broadcasts the transfer and presents a `txHash`. With a shared address, anyone who sees the hash could claim the resource. | MPP spec "Hash Credential Binding": with a static recipient, a server can confirm a payment exists but not that it was made for a specific challenge ([nearintents-mpp-sdk spec](https://github.com/defuse-protocol/nearintents-mpp-sdk/blob/main/docs/spec/draft-nearintents-charge-01.md)). IkerAlus on #3370 (2026-09-14): the payment-proof family's open issue was binding the buyer to the right payment. x402 [`scheme_exact.md`](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact.md) requires a client-submitted method to bind the proof via a unique instrument, a server nonce, a payer signature or a payee commitment, because "a proof establishes that a payment happened, not that it was made for this request." |
| **Concurrent payers on a shared quote.** phdargen asked what happens if clients A and B pay the same cached quote address. IkerAlus: if both land before the swap, 1Click aggregates them and refunds the excess. If B lands after the swap, B's deposit is refunded and B gets nothing. He proposed rotating on first deposit, or a unique address per 402. | [PR #2102 review thread](https://github.com/x402-foundation/x402/pull/2102#discussion_r3926366792) |
| **Refunds.** A quote has a single `refundTo` on the origin chain. Who controls it changed over several revisions: merchant-controlled, then a facilitator-held `refundType: INTENTS` account, then the client's own address supplied in the quote payload. | #3370 comments, 2026-09-04 to 2026-09-23 |
| **Swap pricing and expiry.** `amountIn` depends on a live price and the deadline. Hence the two-step flow (unquoted 402 → quote → quoted 402) and the `operationToken`. Quotes are never reused across requests because the token is a bearer credential. | #3370 spec, and IkerAlus 2026-09-29 |

**Did anyone consider static PoA addresses or `recipientType: INTENTS`?** No. I searched every PR body, issue comment, review and review comment on #3370 and #2102, plus both spec files and the MPP README and spec, for PoA, bridge, `deposit_address`, `recipientType`, static and reuse. Results:

- The only `INTENTS` mention is `refundType: INTENTS`, for a facilitator refund account. It was later dropped.
- Both specs hard-code `recipientType: DESTINATION_CHAIN`.
- "Reuse" only appears for serving one cached 1Click quote to several 402s, which was then forbidden.

The closest discussion is phdargen asking (2026-09-23) whether a facilitator-broadcast variant could have the client sign an EIP-3009 authorization to the quoted `payTo`. IkerAlus saw no blockers. He noted two concerns: gas sponsorship on every origin chain, and that "on Solana, a fresh deposit address has no token account, and the SVM `exact` fee-payer rules don't let the facilitator pay to create it." The current SVM spec has since added `ataCreationRequired` / `ataCreationSponsored`.

**Inference:** none of these reasons applies to Herald's same-asset case:

- No swap, so no quote, price, deadline or refund address.
- Binding comes from the payer signature, not from a unique address.
- The bridge credits any number of deposits to one address. `recent_deposits` lists them individually.

## 4. Attribution under x402 `exact` (verified from spec)

- **EVM.** The facilitator calls `transferWithAuthorization` with the client's signed `authorization {from, to, value, validAfter, validBefore, nonce}`, or calls `x402ExactPermit2Proxy.settle`, which only sends to `witness.to`. The spec says the facilitator cannot modify the amount or destination, and only broadcasts ([scheme_exact_evm.md](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)). The EIP-3009 nonce is a one-time replay primitive.
- **SVM.** The client partially signs a `TransferChecked` to the ATA of `payTo`, with a mandatory Memo for uniqueness. The facilitator co-signs as fee payer and submits ([scheme_exact_svm.md](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)).
- **Settlement response.** Core v2 `SettlementResponse` returns `transaction` (the tx hash or signature), `network` and `payer` ([x402-specification-v2.md](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md) §5.3). The server learns which tx paid which request from its own `/settle` call.
- **`payTo` is static by design.** Core defines `payTo` as the recipient wallet address or a role constant. `scheme_exact.md` puts EIP-3009 and Permit2 in the **facilitator-submitted** family, where binding comes from the signed payment. Only the client-submitted family needs per-request instruments. A static PoA address as `payTo` is the ordinary merchant-wallet case.

What static `payTo` changes for Herald: the facilitator confirms the **origin-chain** transfer. The Intents credit lands a few seconds later and depends on the bridge. To reconcile, poll `recent_deposits(account_id=provider, chain)` and match `tx_hash` to the settlement `transaction`. Watch for `FAILED` or long-`PENDING` rows. Deposits that land at the address without an x402 settlement, such as plain transfers or dust, will show up as unattributed credits. That is harmless for the provider.

## Trust note

Funds at a deposit address are held by the bridge operator, which controls the address keys: the PoA bridge (Defuse) for Base, Arbitrum and Ethereum, and Omni/Wormhole for Solana now. The bridge sweeps the funds and mints the bridged token into `intents.near`. This is the same trust as any Intents deposit. It differs from x402 to a provider-held wallet, where nobody else touches the funds.

## Still requires a small real-money test (needs the human's sign-off)

1. **EIP-3009 via a real x402 facilitator** (for example CDP or Herald's own) to the provider's Base or Arbitrum address, about $0.20. Confirm the `recent_deposits` row, `mt_balance_of` on `intents.near`, and the time from origin block to credit.
2. **Below-minimum on Base**: send 0.01 USDC, then a second deposit that brings the total above 0.15. Is the first one credited, held, or lost?
3. **Polygon USDC during the HOT→Omni migration**: which token id is credited (`nep245:v2_1.omni.hot.tg:137_…` or `nep141:pol-0x3c49….omdep.near`)? Does the address stay the same?
4. **Solana x402 `exact`**: pre-create the ATA (or use `ataCreationSponsored`), pay 0.01 USDC, and confirm the credit.
5. **One unbound EVM address across chains**: a small deposit on a second EVM chain (for example Arbitrum after Base) to the same address, to confirm both are credited.
6. **Many small deposits** to one address in quick succession, for example ten at 0.01 on Arbitrum. Each should get its own `recent_deposits` row with no merging or loss.
7. **Permit2 proxy path** for a non-EIP-3009 token, if Herald offers one.
8. **Long-run stability**: a cron job comparing `deposit_address` for each provider and chain daily for weeks.

## Appendix: raw responses (trimmed)

```text
# deposit_address, herald-test.near (identical at 20:10:03, 20:14:47, 20:20:20 UTC)
eth:1      {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:1"}}
eth:8453   {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:8453"}}
eth:42161  {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:42161"}}
eth:137    {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:137"}}
eth:10/56/43114  same 0xa16d…5D23
sol:mainnet {"result":{"address":"NPyGV1D3uo4M948otwPZ9E7Ax8VfuYm6A8KwF8uuTzs","chain":"sol:mainnet"}}
btc:mainnet {"result":{"address":"bc1qmml5ktqn2jtrcvku6t6afmd9lasp40s8xgwfsy","chain":"btc:mainnet"}}
near:mainnet {"result":{"address":"bc3f796c7c56acc56d6e908b57674fe61864f03511eae856c5cb06cb17e56519","chain":"near:mainnet"}}
tron:mainnet {"result":{"address":"TQgscX1qJMAMbtsgUedZ95otcEyzr8FoSy","chain":"tron:mainnet"}}
ton:mainnet  {"result":{"address":"UQAUaopxGLPYdZDdfzvuf-YMKfK6mIexff5cLL5noxZZ_Wf6","chain":"ton:mainnet"}}

# other accounts (identical at 20:10 and 20:14)
0x1234567890abcdef1234567890abcdef12345678  eth:* 0x885BC6ba8428b4C09934E761D2fd394C17fC508b  sol ByLibfxZb8hL9qxyzNJoyCzzqyJZMNZTr46bxWJjSyGc
0x1234567890ABCDEF1234567890abcdef12345678  (mixed case) same as above
herald-test2.near     eth:* 0x64Ca1771AF51cd85E78919b381B76eB4aDf74Ff2  sol Fy3rs9bhWk6zvzyGmLBj8FuaAdHeJ1d4DvqUkmWnTpG8
herald-provider.near  eth:* 0xB040e2c88874b7Dec2fB3C9C5401455ffb06cb69  sol 6MUNa9hVh4FNWidxrpHePff9c4KohtsLNvpjK8FxXwQN
nonexistent-zzzz-qq.near eth:* 0x3e52BA26846A8aA824e758435dCd806A54DedcCC
0x000000000000000000000000000000000000dead  {"error":"Invalid Account ID"}  (all chains)
0x0000000000000000000000000000000000000001  {"error":"Invalid Account ID"}

# 1Click per-quote account (asset-bound)
deposit_address 944c75b0…d191 eth:8453 -> {"error":"deposit address 0x538c…C1FA is already bound to asset 'eth:8453:0x8335…2913' and cannot be reused for 'none'"}
GET 1click /v0/status?depositAddress=0x538c…C1FA -> status SUCCESS, swapType FLEX_INPUT, depositedAmount 9965000,
    originChainTxHashes [0x7286f262…0ba2], nearTxHashes [A25ktawh…, …]

# Solana recent_deposits
{"tx_hash":"BEAq63Y6…boap","mint_tx_hash":"","chain":"sol:mainnet","near_token_id":"sol-5ce3bf3a…0186.omft.near",
 "amount":37010850,"account_id":"189db6e3…1ce0","address":"HrwZSfRQzRvLpWVrb15ovyriDJdJqRjnRvBuXWodcVKm",
 "status":"COMPLETED","created_at":"2026-11-09T20:16:19.238Z","from":"FiA5DsC8vGai2PoHSdxK8roPLfAWjtnzVm2yjRR4KF5v"}
```

Content from all sources was paraphrased for compliance with licensing restrictions; direct quotes are under 30 words.
