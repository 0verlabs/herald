# Prior art: x402 "pay with any token, provider receives one asset"

Research date: 2026-11-10. Question: has anyone built an x402 gateway or facilitator where the buyer pays with any token on any chain and the API provider receives a single asset, with a swap or bridge in the middle? Special focus on NEAR Intents / 1Click.

Method: web search (about 50 query variants), the GitHub API (repo metadata, PRs and issues in `x402-foundation/x402`, code search for `1click`/`chaindefuser` next to `x402`), npm registry metadata, and live `GET /supported` calls on facilitators. Dates come from GitHub `created_at`/`pushed_at`, npm publish times, or the page's publish date.

Confidence labels used below:

- **Verified**: I read the source (repo README, spec, PR body, docs page, or live endpoint).
- **Claimed**: the project says so, but I did not run it or see on-chain proof myself.
- **Unverified**: only a search snippet or secondary source; treat as a lead.

Note: `https://x402.org/ecosystem` returned HTTP 404 when fetched. I used the facilitator table in the x402 repo instead ([docs/dev-tools/facilitators.md](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md)).

---

## TL;DR

- The idea is **not new**, and the **NEAR Intents team is drafting it as an official x402 spec**. PR [#3370](https://github.com/x402-foundation/x402/pull/3370) adds a `near-intents` method to the `exact` scheme. The buyer pays on any origin chain into a 1Click deposit address, and the merchant receives an exact amount of its chosen asset. The PR is open, under active review, and the wire format is still changing (last activity 2026-11-06).
- The same team shipped the equivalent for **MPP** (Stripe/Tempo's HTTP 402 protocol) as an npm package: [`@defuse-protocol/nearintents-mpp-sdk`](https://github.com/defuse-protocol/nearintents-mpp-sdk).
- Several third parties already have working x402 + 1Click code: [IkerAlus/x402_1CS_gateway](https://github.com/IkerAlus/x402_1CS_gateway), Solvador's [`multichain-exact`](https://github.com/feyyazcigim/solvador-near-intents) scheme, and others.
- Non-NEAR any-token x402 facilitators exist too: **AnySpend x402** (B3), **x402-cross-bridge-sdk** (Relay), and **Stableyard x402plus** (prefunded vault).
- What I did **not** find: a gateway where the provider is paid into a **NEAR Intents (Verifier) balance** and sweeps later, combined with any-asset input. The spec pieces exist (1Click `recipientType: INTENTS`; the `delivery: "internal"` mode in PR [#2948](https://github.com/x402-foundation/x402/pull/2948)), but nobody seems to combine them into a product. See section 3.

---

## 1. Direct matches (x402 or HTTP 402 + any asset in, one asset out)

### 1.1 NEAR Intents `exact` / `near-intents` method for x402 (official spec work)

- **Links:** PR [#3370](https://github.com/x402-foundation/x402/pull/3370) (current), superseding PR [#2102](https://github.com/x402-foundation/x402/pull/2102) (closed). Spec file: `specs/schemes/exact/scheme_exact_nearintents.md` in the PR.
- **Who:** GitHub user IkerAlus. In a review on PR #2948 he describes his position as "NEAR Foundation / NEAR Intents" ([review](https://github.com/x402-foundation/x402/pull/2948)).
- **What it does:** The buyer pays on any supported origin network into a single-use 1Click deposit address, which is used as `payTo`. The NEAR Intents solver network converts the funds and delivers the destination asset to the merchant. The facilitator confirms delivery before the resource runs. Each offered origin chain gets its own `accepts[]` entry. It follows the "client-submitted payment proof" family and `paymentFlow: upfront` ([PR #3370 body](https://github.com/x402-foundation/x402/pull/3370)). PR #2102 had the same core idea with EXACT_OUTPUT quotes and automatic 1Click refunds ([PR #2102](https://github.com/x402-foundation/x402/pull/2102)).
- **Router:** NEAR Intents 1Click Swap API.
- **Status:** Open spec PR, not merged, with no reference implementation in the x402 SDKs yet. Maintainers (phdargen, CarsonRoscoe) are still reworking the design:
  - split the origin leg (`assetTransferMethod`) from the cross-chain leg (a new `assetDeliveryMethod: "near-intents"`);
  - mint the live quote through `/settle` with a non-terminal `requirements_unresolved` result, which turns into a corrective second 402;
  - give the client control of the refund address.

  Source: PR #3370 comments from 2026-11-02 to 2026-11-06. **Verified.**
- **Dates:** #2102 opened 2026-04-22 and closed 2026-08-13. #3370 opened 2026-09-04 and is still open.
- **Related merged groundwork:** PR [#3145](https://github.com/x402-foundation/x402/pull/3145) (merged 2026-08-13) adds `upfront` payment-flow asset transfer methods to `scheme_exact.md`. PR [#3053](https://github.com/x402-foundation/x402/pull/3053) (merged 2026-08-05) adds payment flow handlers.

### 1.2 `nearintents` payment method for MPP (Defuse / NEAR Intents)

- **Link:** [defuse-protocol/nearintents-mpp-sdk](https://github.com/defuse-protocol/nearintents-mpp-sdk). npm `@defuse-protocol/nearintents-mpp-sdk` v0.4.1. Spec `draft-nearintents-charge-01` is registered in `tempoxyz/mpp-specs` and mirrored at [paymentauth.org](https://paymentauth.org/draft-nearintents-charge-01.pdf).
- **What it does:** Cross-chain HTTP 402 payments over **MPP**, not x402. The server's 402 challenge carries a unique 1Click deposit address. The client pays on its origin chain (EVM via viem; BTC, Solana and others by tx hash) and retries with the tx hash. The server then drives the swap to SUCCESS and returns a receipt with the destination delivery hash. Quotes are EXACT_OUTPUT, so the merchant gets a fixed amount. The README says plainly that settlement is not trustless: NEAR Intents holds the deposit during the swap and refunds on failure. It also documents BTC windows of 45–60 minutes and a 504 "re-present later" path for slow settlements ([README](https://github.com/defuse-protocol/nearintents-mpp-sdk)). **Verified.**
- **Router:** 1Click. **NEAR Intents:** yes.
- **Status:** Published library with a browser demo; actively maintained. Repo created 2026-07-20; npm first publish 2026-07-22, latest 2026-11-09.
- **Second implementation:** The Elixir `mpp` library ships `MPP.Methods.NearIntents`, which verifies an origin deposit and waits for 1Click to reach SUCCESS ([hexdocs](https://mpp.hexdocs.pm/MPP.Methods.NearIntents.html)). **Verified** (docs only).
- **Context:** A Binance Square post (2026-07) says NEAR Intents integrated with Stripe and Tempo MPP ([post, French](https://www.binance.com/fr/square/post/343570968130162)). **Unverified** beyond the headline.

### 1.3 x402-1CS Gateway (IkerAlus)

- **Link:** [IkerAlus/x402_1CS_gateway](https://github.com/IkerAlus/x402_1CS_gateway)
- **What it does:** An Express server that turns standard x402 flows into 1Click cross-chain swaps. The buyer pays USDC on Base by signing EIP-3009 or Permit2. The gateway verifies the signature, broadcasts it to the 1Click deposit address, and polls 1Click. The merchant can receive on any of the 32+ chains 1Click supports. The README calls it pilot-ready but not battle-tested. **Verified** (README).
- **Router:** 1Click. **NEAR Intents:** yes.
- **Status:** Working code with Docker and an operator guide. No public hosted instance found. Repo active 2026-04-02 to 2026-08-05.
- **Note:** The origin is limited to EVM USDC (Base) in this design, so it is "any destination" more than "any token in".

### 1.4 Solvador `multichain-exact` (send-to-pay over 1Click)

- **Link:** [feyyazcigim/solvador-near-intents](https://github.com/feyyazcigim/solvador-near-intents). Solvador itself: [solvador.com](https://solvador.com), [docs](https://docs.solvador.com/).
- **What it does:** An x402 scheme where paying means funding a 1Click EXACT_OUTPUT deposit address with one plain transfer from any chain. The payload is just `{ depositAddress }`. The facilitator re-fetches status from 1Click and checks it against the quote's terms. The merchant is paid directly on its own chain (`recipientType: DESTINATION_CHAIN`), and refunds go back to the payer through 1Click. The README reports a live mainnet run: a $0.01 payment funded with Base USDC cost about $0.0101 and arrived in about 35 s. It attributes about 1.2% to routing, of which 0.2% is 1Click's keyless fee. The monorepo also has a `near-intents-exact` balance-based signature scheme and a confidential path behind a flag. **Claimed** (README; I did not check the tx).
- **Router:** 1Click. **NEAR Intents:** yes.
- **Status:** The code exists (repo created 2026-07-17), but it is **not** offered by Solvador's production facilitator. Live `GET https://api.solvador.com/supported` lists only `exact` on `near:mainnet` alongside its EVM, Solana, XRPL and Starknet entries. Solvador's docs list "Swap Settlement" (pay in one token, settle in another) as experimental and "not yet available" ([docs](https://docs.solvador.com/experimental/swap-settlement)). **Verified** 2026-11-10.

### 1.5 AnySpend x402 (B3)

- **Links:** [b3-fun/anyspend-x402](https://github.com/b3-fun/anyspend-x402), [demo](https://github.com/b3-fun/anyspend-x402-demo), [docs](https://docs.anyspend.com/anyspend/x402-overview). Facilitator at `https://mainnet.anyspend.com/x402`.
- **What it does:** A fork of the Coinbase x402 SDK. Buyers pay with any token that supports EIP-2612 or EIP-3009 (EVM) or SPL (Solana). The AnySpend facilitator quotes, swaps to USDC, and settles to the seller. The docs advertise 19+ networks and "cross-chain routing". **Verified** (docs and README). Whether a single payment can start on chain A and settle to a seller on chain B through x402 is **claimed**; I did not test it.
- **Router:** AnySpend, B3's own cross-chain order system. The underlying bridges are **unverified**. **NEAR Intents:** no evidence.
- **Status:** Live hosted facilitator (claimed production). Repo created 2025-10-30. The npm `@b3dotfun/anyspend-x402` package was updated 2026-11-09.
- **Limit:** Tokens without permit or EIP-3009 support are excluded.

### 1.6 x402 Cross-Chain Payment SDK (divi2806)

- **Link:** [divi2806/x402-cross-bridge-sdk](https://github.com/divi2806/x402-cross-bridge-sdk). npm `@x402-crosschain/sdk` and `@x402-crosschain/facilitator`.
- **What it does:** An SDK plus a facilitator. Customers pay with any token on 10+ EVM chains; merchants always get USDC on Base. It uses Permit2 for gasless ERC-20 payments and EIP-3009 for USDC. Settlement goes through **Relay** in 2–3 s (claimed). It works with the standard x402 middleware. **Verified** (README).
- **Router:** Relay. **NEAR Intents:** no.
- **Status:** Self-hosted open source by an individual (1 star). No public hosted facilitator found. Created 2025-12-20, last push 2026-04-02.

### 1.7 Stableyard x402plus (`intent` scheme)

- **Link:** [stableyardfi/x402plus](https://github.com/stableyardfi/x402plus). npm `@stableyard/x402plus` 2.0.0 (2026-03-11).
- **What it does:** Adds an `intent` scheme next to `exact`. The payer deposits USDC once into a "GRID ID", a Safe-based vault, from any chain. After that the payer signs EIP-712 intents per request, and Stableyard settles off-chain. The README claims deposits earn Aave yield. It supports EVM, Solana and Movement. **Verified** (README).
- **Router:** Stableyard's own off-chain settlement. **NEAR Intents:** no.
- **Status:** Library. Repo created 2026-01-15. Production volume is unknown.
- **Relevance:** A prefunded, cross-chain balance model for USDC rather than any-token input. It is the closest non-NEAR analogue to a "balance, then settle" design.

### 1.8 X402-Universal (hackathon)

- **Link:** [X402-Universal/X402-Universal](https://github.com/X402-Universal/X402-Universal)
- **What it does:** Collects many x402 micropayments on one chain in a pool contract. An admin then batch-bridges them to providers on destination chains through Hyperbridge (Polkadot), converting to USD.h. **Verified** (README).
- **Router:** Hyperbridge. **NEAR Intents:** no.
- **Status:** Hackathon demo, a Token2049 Origins top-5 finalist that also won a Polkadot prize. Created 2025-09-30.
- **Relevance:** Has the **aggregate then batch-pay-out** shape that "sweep later" also needs, but not any-token input.

### 1.9 Earlier and smaller NEAR + x402 demos

- **NEAR Intents x402 example, May 2025:** PR [#123](https://github.com/x402-foundation/x402/pull/123) and [#107](https://github.com/x402-foundation/x402/pull/107) by think-in-universe (Robert Yan, GitHub profile company "NEAR Protocol"). It was a proxy in front of the NEAR Intents RPC. The proxy priced each intent in Base USDC and returned a 402, and the x402 client paid automatically, so the agent could end up with USDC on NEAR. The PR was closed unmerged on 2026-01-18. **Verified.** This is the earliest NEAR + x402 cross-chain work I found. It came right after the x402 launch, where Illia Polosukhin was quoted saying NEAR wanted to combine x402 with NEAR Intents so developers collect revenue through cross-chain settlement ([Coinbase launch post](https://www.coinbase.com/developer-platform/discover/launches/x402)).
- **Anyone Pay:** [kurodenjiro/Anyone-pay](https://github.com/kurodenjiro/Anyone-pay) (2025-11 to 2026-01). Buyers deposit shielded Zcash. 1Click bridges it to USDC on Base or Solana, and a relayer that uses NEAR Chain Signatures pays x402 merchants. Most likely a hackathon project. **Verified** (README).
- **JustaLab x402 × NEAR Intents demo:** [JustaLab-co/x402-near-intents-demo](https://github.com/JustaLab-co/x402-near-intents-demo) (2026-10-08). Here x402 pays for a swap **quote**, and the swap itself then settles through NEAR Intents. The inverse of our problem. **Verified.**

---

## 2. Partial matches

### 2.1 NEAR-native x402 (same chain, no swap)

| Item | What it is | Status | Source |
|---|---|---|---|
| `exact` scheme on NEAR | The payer signs a NEP-366 `SignedDelegateAction` for one `ft_transfer` of a NEP-141 token; a facilitator relayer submits it and pays gas. x402 v2 only. | Spec merged 2026-05-16 (PR #1459); reference implementation `@x402/near` (PR [#2663](https://github.com/x402-foundation/x402/pull/2663), merged 2026-06-18; npm first published 2026-07-06, v2.30.0) | [spec](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_near.md) |
| `intents-verifier` transfer method for exact/NEAR | Settles through the NEAR Intents Verifier (`intents.near`) using a signed intent from a payer who **already holds a Verifier balance**. Two delivery modes: `wallet` (an `ft_withdraw` to the merchant's account) and **`internal`**, where the merchant is credited inside the Verifier ledger and withdraws separately. Same asset only, `near:mainnet` only. | Open PR [#2948](https://github.com/x402-foundation/x402/pull/2948) by mikedotexe, opened 2026-07-24; approved in review by IkerAlus (NEAR Intents) | PR diff, **verified** |
| NEAR x402 Facilitator (mikedotexe) | Open-source facilitator for exact Circle USDC on NEAR and Base, zero fee, sponsored gas. Live `/supported` returns only `exact` on `near:mainnet` from that host. | Live; listed in the official facilitator table (PR [#2941](https://github.com/x402-foundation/x402/pull/2941)) | [site](https://x402.mikedotexe.com/) |
| x402.org NEAR testnet registration | The issue says NEAR Intents support stays in "watch/review mode" until the `upfront` scheme direction is settled upstream. | Open issue [#2812](https://github.com/x402-foundation/x402/issues/2812) (2026-07-07) | **verified** |
| Solvador | Hosted multi-network facilitator (15 mainnets, including `near:mainnet` `exact`). | Live | [docs](https://docs.solvador.com/) |
| NEAR Foundation joins the x402 Foundation | NEAR positions Intents as liquidity "across every chain and asset" alongside x402. No product announced. | Announced 2026-07-14 | [NEAR blog](https://near.org/blog/near-foundation-joins-x402-foundation), [Nansen Q3 report](https://nansen.ai/post/near-q3-2026-report) |
| x402 Bazaar (402.com.tr) | API marketplace that settles x402 on Base; says NEAR agents get NEAR Intents quotes and can pay from NEAR. Mechanism not documented. | Live site; mechanism **unverified** | [site](https://402.com.tr/) |
| Saku (Gliana Labs) | A NEAR contract owns the agent's Base wallet through Chain Signatures and pays standard x402 sellers within a budget. It tops up through NEAR Intents (NEAR in, Base USDC out). Buyer side only. | NEAR Hackathon 2026 project, mainnet receipts in README | [repo](https://github.com/Gliana-Labs/gliana-near-x402) |

NEAR AI, HOT and the NEAR Agent Market: I found **no** shipped or announced x402 facilitator from any of them. NEAR AI was a launch partner in the Coinbase x402 announcement ([launch post](https://www.coinbase.com/developer-platform/discover/launches/x402)). The NEAR Foundation post names Agent Market only as a discovery and coordination layer ([NEAR blog](https://near.org/blog/near-foundation-joins-x402-foundation)). Confidence: medium. Something may exist that search engines did not index.

### 2.2 Multichain or multi-token facilitators (same chain, no cross-chain swap)

These accept many chains and often many tokens, but the buyer must pay on the merchant's advertised chain and in its advertised asset.

| Name | Scope | Source |
|---|---|---|
| Coinbase CDP Facilitator | Multiple EVM networks plus Solana; any ERC-20 via EIP-3009 or Permit2 (token-agnostic since 2026-03). No cross-chain settlement found in the docs. | [CDP docs](https://docs.cdp.coinbase.com/x402/network-support), [ERC-20 launch](https://www.coinbase.com/developer-platform/discover/launches/x402-ERC20) |
| PayAI | Solana-first, multi-network, "all tokens" | [facilitator](https://facilitator.payai.network/), [x402 table](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md) |
| Corbits (Faremeter) | Multi-network, multi-token, EVM and Solana | [x402 table](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md) |
| thirdweb | 35+ chains; any ERC-2612 permit token; EIP-7702 gasless | [changelog: 26 chains](https://blog.thirdweb.com/changelog/expanding-x402-payments-to-26-new-chains/), [any ERC-20](https://blog.thirdweb.com/changelog/x402-payments-in-any-erc20-token/) |
| Daydreams facilitator | EVM, Solana, Starknet. A "Dreams Router" is described as handling multichain USDC settlement (**unverified**) | [repo](https://github.com/daydreamsai/facilitator), [Alchemy listing](https://www.alchemy.com/dapps/daydreams) |
| Heurist, 1Shot, Fireblocks, AlgoVoi, Meridian, Dexter, Polygon, Celo, Mogami, X Pay, T54, Sui, Canton | Single- or multi-network facilitators | [x402 table](https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/facilitators.md), [Heurist](https://facilitator.heurist.ai/), [1Shot](https://github.com/uxlySoftware/1shot-x402) |
| Routex | Client-side router that picks the cheapest chain among those the merchant already accepts. No swap. | [repo](https://github.com/routexcc/routex) |
| Stellar "swap asset transfer method" (FxPay) | **Same-chain** swap: a Soroban contract pulls XLM or EURC, swaps on Soroswap, and pays the exact USDC amount. Reported live on Stellar mainnet. | Issue [#4091](https://github.com/x402-foundation/x402/issues/4091) (2026-11-02) |

Questflow, Crossmint, Fluora, Zauth, AurraCloud: Questflow uses CDP wallets and x402 ([case study](https://www.coinbase.com/developer-platform/discover/case-studies/questflow)). The Crossmint x402 flow requires the wallet to already hold USDC ([docs](https://docs.crossmint.com/agents/payment-flows/x402)), with LI.FI bridging offered as a separate wallet extension ([docs](https://docs.crossmint.com/wallets/guides/wallet-extensions/bridge-lifi)). Fluora is a marketplace that settles USDC on Base ([site](https://www.fluora.ai/)). Zauth does endpoint verification and trust ([site](https://www.zauth.inc/)). I found nothing on AurraCloud claiming any-token or cross-chain x402. None of these claim cross-chain, any-token settlement.

### 2.3 Cross-chain, but USDC-only or payout-side

- **Circle Gateway Nanopayments.** The buyer makes a one-time USDC deposit into a Gateway Wallet contract and then signs EIP-3009 authorizations off-chain. Gateway batches settlement and credits the seller's Gateway balance. The seller can withdraw to any supported chain, near instantly ([overview](https://developers.circle.com/gateway-nanopayments), [batched settlement](https://developers.circle.com/gateway-nanopayments/concepts/batched-settlement.md)). Circle proposed this in issue [#447](https://github.com/x402-foundation/x402/issues/447) (2025-10-10). Live. USDC only, no swap. Structurally it is **the closest analogue to "receive into a ledger, sweep later"**.
- **LI.FI.** A help-center article (2026-01-02) describes cross-chain x402 payments: LI.FI's Executor contract on Base receives the bridged USDC and pays the x402 agent the exact amount ([LI.FI help](https://help.li.fi/hc/en-us/articles/45007606435611-How-can-I-integrate-cross-Chain-Payments-x402-for-AI-Agents)). This is integration guidance, not a facilitator. The full page was behind Cloudflare, so I only read the search snippet: **unverified**. LI.FI also markets "pay with any token on any chain" for payments in general ([li.fi/payments](https://li.fi/payments)).
- **tools402.** Merchants pick a payout chain and are paid USDC daily, cross-chain via CCTP ([site](https://tools402.dev/)). **Unverified** beyond the landing page.
- **Vantis (Robinhood Chain).** The agent pays USDG on Robinhood Chain, and the site says Base x402 merchants get paid on Base "in its own terms". It does not explain how ([site](https://facilitator.vantis.sh/)). **Unverified.**
- **Chainlink Convergence hackathon.** "AI Agent Swarm with Autonomous Payments" lists x402 payments with cross-chain settlement over CCIP ([project](https://chain.link/hack-26/projects/ai-agent-swarm-with-autonomous-payments)). Hackathon demo. **Unverified** detail.

### 2.4 Buyer-side adapters (swap or bridge before paying a normal x402 merchant)

These leave the merchant unchanged. The agent's wallet converts funds first, so the provider still receives whatever it advertised on its own chain.

- **Dynamic + Fireblocks Flow.** When the agent holds the wrong token or chain, it swaps or bridges before signing x402 or MPP ([Dynamic docs](https://www.dynamic.xyz/docs/agents/agent-payments)). The referenced repo `dynamic-labs-oss/dynamic-agent-payments` returned 404 through the API: **unverified**.
- **Agent Payment Node (nuanu-ai/APN).** A local payment runtime that does standard x402 plus bridges (LI.FI/Across/Stargate, Relay, CCTP V2, NEAR 1Click) and guarded swaps ([repo](https://github.com/nuanu-ai/agent-payment-node), 75 stars, active 2026-11).
- **thirdweb `useFetchWithPayment`.** Shows a modal to help the user fund the wallet when payment fails for insufficient funds ([docs](https://portal.thirdweb.com/references/typescript/v/useFetchWithPayment)). Human-in-the-loop.
- **Saku** (section 2.1) and **Anyone Pay** (section 1.9) also fit here.

### 2.5 Agent payment rails that are not x402

- **MPP + `nearintents`** (section 1.2).
- **Stripe x402 / MPP.** Stripe gives the merchant a deposit address and records each payment as a PaymentIntent. Settlement is same-chain (Base in the example) through the CDP facilitator ([Stripe docs](https://docs.stripe.com/payments/machine/x402)).
- **Eco Routes.** Eco markets a stablecoin route API for any token on any chain to agentic checkout ([Eco article](https://eco.com/support/en/articles/15192004-agent-pay-implementation-developer-guide-for-ai-checkout-in-2026)). I found no x402 facilitator from Eco.

---

## 3. Gap analysis

### 3.1 What already exists, by shape

| Shape | Who | Gap |
|---|---|---|
| Per-payment 1Click EXACT_OUTPUT swap, delivered to the merchant's destination chain | PR #3370 (spec), Defuse MPP SDK (shipped, MPP), x402_1CS_gateway, Solvador `multichain-exact` (code) | Taken. The NEAR Intents team owns the standard path. |
| Any permit-token in, USDC out, through a hosted facilitator | AnySpend (B3), divi2806 (Relay) | Taken on EVM and Solana. No NEAR, BTC or other non-permit inputs. |
| Prefunded cross-chain balance, pay per call off-chain | Stableyard x402plus, Circle Gateway | USDC only. Payers must deposit USDC first. |
| Same-asset payment from a NEAR Intents balance, merchant credited internally | PR #2948 `intents-verifier`, `delivery: "internal"` | Spec only. Payer must already hold the exact asset in `intents.near`. |
| Aggregate, then batch pay-out cross-chain | X402-Universal (Hyperbridge), Circle Gateway withdrawals | No any-token input; X402-Universal is a demo. |

### 3.2 What nobody seems to do yet

None of the following showed up in any search, repo, PR, or live `/supported` endpoint. Confidence: medium-high for public, indexed work; low for private or very recent work.

1. **Merchant settles into a NEAR Intents account, not its wallet, with any-asset input, and sweeps later.** 1Click supports this on the delivery side: its OpenAPI lists `recipientType` values `DESTINATION_CHAIN`, `INTENTS` and `CONFIDENTIAL_INTENTS` ([1Click OpenAPI](https://1click.chaindefuser.com/docs/v0/openapi.yaml)). Every x402/MPP implementation I found uses `DESTINATION_CHAIN` (Solvador's README states this explicitly) or leaves it unstated. PR #2948's `internal` mode defines the "merchant knowingly accepts a Verifier-ledger balance" semantics, but only for same-asset payers.
2. **Any-asset top-up into the payer's Intents balance, then cheap per-call payments.** Combine a one-time 1Click deposit of any asset (BTC, SOL, ETH, …) into the payer's Intents balance with per-request `intents-verifier` transfers in `internal` mode. Each call is then a signed off-chain intent plus one NEAR transaction, with no per-call cross-chain swap. This is the Circle Gateway / x402plus prepaid model, but with any asset and any chain in. I found no implementation.
3. **Merchant-side treasury tooling.** Batched sweeps or withdrawals from the Intents balance to a chosen chain and asset, a reconciliation ledger per x402 payment, and payout policies. Nobody describes this for x402.
4. **Micropayment economics on 1Click.** The per-payment designs inherit cross-chain latency (Solvador measured about 35 s for a $0.01 payment; the Defuse SDK uses 45–60 minute windows for BTC) and route fees of about 1.2% on a $0.01 payment (Solvador README). None of them amortize this for sub-cent API calls.

### 3.3 How a NEAR-Intents "pay with anything → provider Intents account → sweep later" gateway would differ

Compared with PR #3370, the Defuse MPP SDK, and Solvador:

- **Delivery target.** The 1Click quote uses `recipientType: INTENTS`, or `CONFIDENTIAL_INTENTS`, crediting the provider's account inside `intents.near`. No per-payment withdrawal to the destination chain, so destination-chain gas, latency, and storage-registration preflight are avoided. In the upstream discussion's terms, this is a different `assetDeliveryMethod` target than "deliver to wallet on destination chain" ([PR #3370](https://github.com/x402-foundation/x402/pull/3370) comments).
- **Sweep as a separate, batched step.** The provider (or the gateway acting for it) later withdraws the accumulated balance in one operation to any chain and asset, like Circle Gateway's "withdraw to any chain" but not tied to USDC.
- **Two payer paths in one 402.** (a) Payers who already hold an Intents balance pay with `intents-verifier` / `internal`: fast, same asset, no swap. (b) Everyone else pays through a 1Click deposit address with `recipientType: INTENTS`: slow, any asset. Path (b) can be a top-up (path 2 in section 3.2) instead of a per-call swap.
- **Optional confidentiality.** `CONFIDENTIAL_INTENTS` could hide merchant revenue. Solvador does this on Base with its own encrypted state ([docs](https://docs.solvador.com/confidential-settlement)), and NEAR made Confidential Intents generally available in July 2026 ([Nansen](https://nansen.ai/post/near-q3-2026-report)).

Risks and open questions to check before building:

- **Custody and blast radius.** PR #2948 notes that funds in the Verifier ledger sit in the shared `intents.near` contract. Any key authorized for an account can move that account's whole balance, so it recommends keeping standing balances small. A sweep-later design deliberately holds a standing merchant balance.
- **1Click trust model.** Deposits are held by the NEAR Intents settlement system during the swap ([Defuse SDK README](https://github.com/defuse-protocol/nearintents-mpp-sdk)).
- **Standard churn.** The upstream design (quote through `/settle`, `assetDeliveryMethod`, client-controlled `refundTo`) was still changing in November 2026. A gateway should track PR #3370 and PR #2948 rather than fork the wire format.
- **Competitive overlap.** The NEAR Intents team, Solvador (which says swap settlement is "experimental"), and AnySpend could each add an "into Intents balance" option with small changes. The parts that are actually new are the sweep, treasury and prepaid-balance layer, and the micropayment economics, not "x402 + 1Click" itself.
- **Not verified here.** Whether 1Click's `INTENTS` recipient type works with EXACT_OUTPUT for arbitrary destination assets. Minimum amounts and fees for `INTENTS` delivery versus `DESTINATION_CHAIN`. Whether `intents-verifier` `internal` transfers can be submitted gaslessly by a facilitator for all signature standards (the PR lists `nep413` and `erc191` as required).

---

## Appendix: names checked

Direct or near-direct: NEAR Intents x402 `near-intents` spec (PR #3370/#2102), Defuse `nearintents-mpp-sdk`, Elixir `MPP.Methods.NearIntents`, IkerAlus x402_1CS_gateway, Solvador `multichain-exact`, AnySpend x402 (B3), divi2806 x402-cross-bridge-sdk, Stableyard x402plus, X402-Universal, NEAR Intents x402 example (PR #123), Anyone Pay, JustaLab x402 × NEAR Intents demo.

Partial: `@x402/near` exact scheme, `intents-verifier` PR #2948, NEAR x402 Facilitator (mikedotexe), Solvador, x402 Bazaar (402.com.tr), Saku (Gliana), Circle Gateway Nanopayments, LI.FI guidance, tools402, Vantis, Chainlink CCIP hackathon project, Dynamic/Fireblocks Flow, Agent Payment Node, thirdweb, CDP, PayAI, Corbits, Daydreams, Heurist, 1Shot, Fireblocks, Routex, Stellar FxPay, Stripe, Eco.

No relevant cross-chain or any-token x402 claim found: NEAR AI, HOT, NEAR Agent Market, Questflow, Crossmint (beyond the client-side LI.FI bridge), Fluora, Zauth, AurraCloud, Squid, deBridge, Socket, Across (except through APN and LI.FI), Wormhole, Axelar.
