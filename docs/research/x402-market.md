# x402 market check: payment asset, payment size, chain share

Claim under test: "Most x402 buyers hold and pay with stablecoins (not ETH/BTC), and most x402-paywalled APIs are priced under $1, because x402 is meant for micropayments."

Research date: 2026-11-10. Content from third-party sources was rephrased for compliance with licensing restrictions. Items marked **[unverified]** were seen only in a search-result snippet, or come from a secondary article whose underlying data I could not open.

## Verdict: partly holds

| Part of the claim | Verdict | Short reason |
| - | - | - |
| Buyers pay with stablecoins | **Holds, strongly** | 99.3% to 99.99% of x402 value settles in USDC, depending on the source and window. Non-stablecoin payments are close to zero. |
| Buyers *hold* stablecoins (as opposed to other assets) | **Not shown** | The data covers what buyers pay with, not what they hold. Chainalysis found x402 payer wallets on Base hold about 26 different tokens on average. |
| Most paywalled APIs are priced under $1 | **Holds, strongly** | 99.4% of the 33,064 priced resources in Coinbase's Bazaar catalog cost ≤ $1. The median price is $0.005. |
| Most *payments* are under $1 | **Holds by count, fails by value** | More than 87% of Base payments fall between $0.0001 and $0.10. But Chainalysis found ≥ $1 transactions carried 95% of Base x402 *value* by early 2026, and much of that value is wash or self-payment traffic. |
| "...because x402 is meant for micropayments" | **Partly** | Micropayments are the design intent. The USDC share and the sub-$1 prices also follow from SDK defaults: EIP-3009/USDC is the default transfer method, and the stock client only pays USD stablecoins with a $1 per-payment cap. The protocol itself allows any token and any amount. |

Practical reading: if you count listings or payments, x402 is a USDC micropayment rail. If you count dollars, most of the value sits in a small number of larger or artificial flows, and only about 45% of the last 30 days of raw volume passes an organic filter.

---

## 1. Payment asset share

### On-chain and first-party numbers

| Figure | Window | Source |
| - | - | - |
| $52.47M of $52.68M (99.6%) of x402 settlements were in USDC. TRM's test placed no restriction on the asset. Across Base, Solana and Polygon. | May 2025 to ~Sep 2026 | [TRM Labs, 2026-09-09](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain) |
| Circle CEO on the Q3 2026 earnings call: over 99% of agent payments on x402 settle in USDC. Circle's agent marketplace lists nearly 2,800 endpoints. | stated 2026-11-04 | [Circle Q3 2026 call transcript (Motley Fool)](https://www.fool.com/earnings/call-transcripts/2026/11/04/circle-crcl-q3-2026-earnings-call-transcript/) |
| 99.3% of x402 agent-payment volume settled in USDC in Circle's Q2 2026. This is Circle's own figure, reported secondhand. | Q2 2026 | [crypto.news, 2026-08](https://crypto.news/usdc-powers-99-3-percent-of-x402-ai-agent-payments/) |
| USDC carried more than 99.99% of agentic transfer volume on x402 over 90 days. The article does not name its data source. **[unverified]** | ~90 days to Aug 2026 | [Crypto Briefing](https://cryptobriefing.com/usdc-dominates-agentic-transfer-volume-x402/) |
| 99.8% of x402 agentic payments settle in USDC. **[unverified]** (snippet only) | May 2026 | [CoinLaw](https://coinlaw.io/usd-coin-statistics/) |

Caveats on measurement:
- Many trackers define x402 as USDC transfers, so they cannot measure asset share. The arXiv census defines a Base x402 settlement as a USDC transfer that emits `AuthorizationUsed`, and defines Solana settlements as USDC SPL transfers ([arXiv 2607.12575](https://arxiv.org/html/2607.12575v1)). x402stats sums USDC received by sellers ([x402stats](https://x402stats.io/)). TRM's 99.6% is the best figure here because TRM did not filter by asset.
- Dune's curated agentic-payments table does not limit x402 rows to stablecoins. It can include EIP-3009 tokens such as EURC, other ERC-20s, and SPL tokens ([Dune docs](https://docs.dune.com/data-catalog/curated/payments/agentic-payments)). I did not run a query on it, because that needs an API key.

### What sellers accept: Coinbase Bazaar catalog (pulled by me)

I downloaded all 33,279 resources from the CDP discovery API (`https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources`, 34 pages of 1,000, pulled 2026-11-10). The catalog has 92,035 `accepts` entries. A resource lists one entry per network/asset it accepts.

| Measure | Value |
| - | - |
| Resources that accept only stablecoins | 30,072 (90.4%) |
| Resources that accept a stablecoin plus some non-stablecoin option | 3,204 (9.6%) |
| Resources that accept no stablecoin at all | 3, with 41 paid calls in 30 days combined |
| Largest entry type | Base USDC, 33,903 entries; next is Solana USDC with 12,025 |
| Non-stablecoin assets offered | XRP (2,361 entries), wrapped SOL (90), sBTC, Nano, BTC over Lightning (Bitrefill), and a few memecoins |

Most of the non-stablecoin offers are XRP options on templated `*.workers.dev` API hosts. I count 2,494 resources across a small group of hosts.

### Structural facts (confirmed)

- **Buyer spend controls.** By default, the x402 client only pays recognized USD-pegged assets such as USDC, and it caps each payment at $1. The defaults are the same in TypeScript, Go and Python. To raise the cap, set `maxAmountPerPayment`. To pay other tokens, opt in through `allowedAssets`, or disable the controls entirely. ([Quickstart for Buyers, Spend Controls](https://docs.x402.org/getting-started/quickstart-for-buyers)) **Confirmed.**
- **`exact` EVM transfer method.** `eip3009`, which uses the token's native `transferWithAuthorization` and is "commonly for USDC", is the default where the token supports it. `permit2` covers ERC-20s that lack EIP-3009 ([exact scheme docs](https://docs.x402.org/schemes/exact)). **Confirmed, with one correction:** the default is EIP-3009, which is not USDC-specific. EURC and some other tokens implement it too. Bazaar entries show `assetTransferMethod: "eip3009"` on Base USDC.
- **Buyer prerequisites.** The Quickstart lists a wallet holding USDC as a prerequisite for buyers ([Quickstart for Buyers](https://docs.x402.org/getting-started/quickstart-for-buyers)).
- **Server-side `$` prices.** Dollar-string prices like `"$0.01"` only resolve on networks where a default stablecoin is configured. See `docs/research/x402.md` §"Networks & Token Support" in this repo.

These defaults are a sufficient explanation for USDC dominance even without micropayment economics.

---

## 2. Payment size distribution

### Listed prices: Bazaar catalog (pulled by me, 2026-11-10)

Price is the lowest atomic amount on any 6-decimal USDC entry, divided by 10⁶. 33,064 of the 33,279 resources have a parseable USDC price. "Calls" is Bazaar's `quality.l30DaysTotalCalls`, which is CDP-reported paid calls over the last 30 days. Total calls across all resources: 783,784.

| Price bucket | Share of resources | Share of 30-day calls |
| - | - | - |
| < $0.001 | 0.02% | 0.05% |
| $0.001 – < $0.01 | 53.6% | 55.9% |
| $0.01 – < $0.10 | 38.4% | 42.3% |
| $0.10 – $1.00 | 7.3% | 1.6% |
| > $1 – < $10 | 0.5% | 0.05% |
| ≥ $10 | 28 resources (0.08%) | 0.10% |

- Median listed price: **$0.005**. The call-weighted median is also $0.005. Mean: $0.115. 90th percentile: $0.05. 99th percentile: $1.00.
- **99.4%** of resources cost ≤ $1. 92.1% cost < $0.10. 53.6% cost < $0.01.
- **98.2%** of paid calls go to resources priced < $0.10, and 99.85% to resources priced ≤ $1.
- I also restricted to resources with at least 3 unique payers in 30 days, to drop test listings. That leaves 5,789 resources. Their median price is $0.005, 99.8% cost ≤ $1, and 67% cost < $0.01.
- **Value is a different picture.** For `exact` resources, listed price × calls gives about $22.7k of implied 30-day spend. **48%** of that comes from resources priced above $1, even though they get only 0.15% of calls (1,145 of 782,542).
- Catalog quality caveats:
  - The catalog has 3,256 hosts. The top 8 hosts produce 17.5% of listings. In June 2026, two template factories produced 77% of Base listings ([arXiv 2607.12575](https://arxiv.org/html/2607.12575v1)).
  - Bazaar is a CDP-run catalog, so the call counts are biased toward sellers that use the CDP facilitator.

### Realized payment sizes (on-chain trackers)

| Figure | Window | Source |
| - | - | - |
| More than 87% of x402 payments on Base fall between a hundredth of a cent and $0.10. The most common size is $0.01–$0.10. More than 138M cumulative Base payments. | 16 months to Sep 2026 | [Chainalysis, North America 2026](https://www.chainalysis.com/blog/north-america-crypto-adoption-2026/) |
| On Base, transactions of ≥ $1 rose from 49% of x402 value in early 2025 to 95% by early 2026. The $0.10–$1 band fell from 46% to 4% of value. | early 2025 → early 2026 | [Chainalysis, "Inside x402"](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/) |
| Last-30-day average from x402scan: 4,569,810 transactions and $1,594,203 total, which is **$0.35 per payment** on average. Read from the embedded page data; latest block 2026-11-09T18:45Z. | ~2026-10-10 → 2026-11-09 | [x402scan](https://www.x402scan.com/) |
| Last-30-day average from x402stats (unfiltered): $1.53M over 4.50M transactions, also **$0.34**. Median *seller revenue* is $0.04. The top 10 wallets hold 87% of volume. | 2026-10-11 → 2026-11-09 | [x402stats llms-full.txt](https://x402stats.io/llms-full.txt) |
| Q3 2026: 68.3M agent-classified payments totaling $3.7M, about $0.05 average. Attributed to Token Terminal, Allium and TRM. **[unverified]** (secondary; underlying data not opened) | Q3 2026 | [Crypto Briefing](https://cryptobriefing.com/ai-agent-payment-value-drops-94-percent/) |
| Average Base transaction value of about $0.13, per Token Terminal. **[unverified]** (secondary) | ~mid-2026 | [Crypto Briefing](https://cryptobriefing.com/usdc-dominates-agentic-transfer-volume-x402/) |

Monthly average payment, computed from the x402stats daily CSV (volume ÷ transactions, unfiltered, all facilitators) ([CSV](https://x402stats.io/api/stats/csv)):

| Month | Volume | Transactions | Avg per payment |
| - | - | - | - |
| 2025-10 | $4.01M | 4.12M | $0.97 |
| 2025-11 | $28.79M | 68.6M | $0.42 |
| 2025-12 | $8.41M | 65.0M | $0.13 |
| 2026-01 | $1.80M | 21.6M | $0.08 |
| 2026-03 | $2.42M | 2.92M | $0.83 |
| 2026-07 | $0.73M | 12.7M | $0.06 |
| 2026-08 | $1.45M | 21.3M | $0.07 |
| 2026-10 | $1.51M | 3.50M | $0.43 |

The average swings by 10x from month to month. The swings come from campaigns that change the mix of payment sizes, not from changes in API prices.

### How wash and test traffic skews the numbers

- **PING mints in Oct 2025.** PING was a pay-to-mint token that cost exactly 1 USDC per x402 call. Transactions grew more than 10,000% in a week, and PING alone had over 150k transactions in its first month ([Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)). This explains why October 2025 averages about $1 per payment. It inflates value and pushes the size distribution toward $1.
- **Self-payment fleet in Nov 2025.** Three wallets made 27.1M settlements almost entirely to themselves, and all stopped on 2025-11-28 ([arXiv 2607.12575](https://arxiv.org/html/2607.12575v1)). Across the census (Base, 2025-09-17 to 2026-06-23), provably fictitious self-payment and closed loops are **21.2% of settlement count but 54.1% of value** ($23.86M of $44.12M). Operator-internal clusters are another 63.8% of count but only 16.8% of value. Only $187,861 provably reaches a nameable catalog service. So wash traffic **inflates value more than count**, and it inflates the ≥ $1 value share that Chainalysis reports.
- **Organic filter at x402stats.** In the last 30 days, $754k of $1.68M raw (45%) passes the organic filter. Only 97 sellers qualify as organic. The filter requires ≥ $100 revenue, ≥ 3 buyers, an average payment of at least $0.001, and excludes settlement wallets ([x402stats](https://x402stats.io/llms-full.txt)).
- **TRM screens.** After removing self-payments, bulk flows from one or two payers, and sellers with fewer than 10 buyers, $25.62M of $52.7M remains. TRM estimates only 0.6%–7.5% of that remainder is agentic. TRM puts agent-moved volume at roughly $5k–$11k a month ([TRM Labs](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain)).
- **Effect on the claim.** Removing wash traffic *strengthens* the claim that most payments are small. The remaining organic flow is dominated by $0.001–$0.10 calls in the Bazaar data. It also shrinks the total market to well under $1M a month.

---

## 3. Chain share

| Figure | Window | Source |
| - | - | - |
| Base: 136.7M settlements and $44.12M. Solana: 49.5M settlements and $9.03M (Solana counted with a coarser rule). That is **Base ≈ 83% of value, ≈ 73% of count**. | 2025-09-17 → 2026-06-23 | [arXiv 2607.12575](https://arxiv.org/html/2607.12575v1) |
| x402scan homepage, current window. Base: 3,766,320 transactions and $1,291,278. Solana: 803,490 transactions and $302,926. That is **Base 82.4% of count, 81.0% of value**. | ~30 days to 2026-11-09 | [x402scan ?chain=base](https://www.x402scan.com/?chain=base), [?chain=solana](https://www.x402scan.com/?chain=solana) |
| By 30-day seller volume, FluxA (Base only) is 52.3% and Coinbase CDP (Base and Solana) is 40.1%. All other facilitators are ≤ 5.3%. | 30 days to 2026-11-09 | [x402stats](https://x402stats.io/llms-full.txt) |
| TRM's dataset covers Base, Solana and Polygon. | May 2025 → Sep 2026 | [TRM Labs](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain) |
| Base 82.5% and Solana 17.4% of volume. **[unverified]** (SSRN abstract snippet; page returned 403) | n/a | [SSRN 7450602](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7450602) |
| Base plus Solana make up about 98% of cumulative x402 value since May 2025, citing DefiLlama. **[unverified]** (press release snippet) | to 2026-11-04 | [Research Tree / RoundhouseAI](https://www.research-tree.com/newsfeed/article/roundhouse-ai-ltd-dashboard-extended-to-solana-3533512/nid/3533512) |
| Solana had more than 88% of x402 *transactions* in the week of 2026-02-02. **[unverified]** | Feb 2026 | [SolanaFloor](https://solanafloor.com/news/solana-commands-49-of-x402-market-share-as-the-race-for-micropayment-dominance-intensifies) |
| Solana at about 70% of monthly x402 volume in mid-Aug 2026, citing x402scan, and passed Base in daily transactions on 2026-08-25. **[unverified]** The same article says $24.24M over 30 days, which is about 15x what x402stats measured for August ($1.45M), so its figure likely counts something different. | Aug 2026 | [Crypto Briefing](https://cryptobriefing.com/solana-x402-market-share-dominance/) |

Reading: **Base leads on value**, at about 80%+ in both the long-window census and the current 30 days. Solana has periodically led on transaction count, during campaign-driven weeks in Feb and Aug 2026, but it is about 18% of count right now. Other chains (Polygon, Arbitrum, Arc, XRPL and others) appear often in seller `accepts` lists but carry little settled volume.

---

## 4. Counter-evidence

**Payments above $1** (from the Bazaar pull, 30-day paid calls, 2026-11-10):
- `api.bitrefill.com/x402/invoice/pay` uses the `upto` scheme with a **$1,000 cap** to buy gift cards, eSIMs and top-ups. It had 55 calls from 22 payers. The amounts actually charged are not visible in the catalog.
- `api-xpay.com` text endpoints are priced at **$10–$20 per call** (rewrite, sentiment, keywords, classify). They had about 660 calls from about 555 payers. Nearly one call per payer suggests one-off or test use.
- `laso.finance` card and bank endpoints charge $5–$11.50 per call (get-card, fund-card-balance, send-bank-payment). `cheaptokens.ai/api/buy` charges $1.00 and had 561 calls.
- In total, 199 catalogued resources are priced above $1 and 28 at $10 or more. They earn about 48% of implied `exact` spend.
- On-chain, ≥ $1 transactions carried 95% of Base x402 value by early 2026 ([Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)). Some of this is PING's $1 mints and the self-payment fleet. Across the broader Base EIP-3009 universe, which is mostly not x402, transfers above $1k are 0.04% of count but 88.7% of value ([arXiv](https://arxiv.org/html/2607.12575v1)).

**Non-stablecoin payments:**
- TRM found about $0.21M of $52.68M (0.4%) was not USDC. Some of that may be other stablecoins ([TRM](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain)).
- 3,204 Bazaar resources offer XRP, SOL, BTC over Lightning (Bitrefill), sBTC or Nano alongside USDC. Only 3 accept non-stablecoins exclusively, with 41 calls in 30 days.
- The spec supports non-stablecoin rails: Permit2 for any ERC-20, an `exact` Bitcoin Lightning spec, and an XRPL spec ([exact scheme docs](https://docs.x402.org/schemes/exact)). Stock clients will not use them unless the buyer opts in.

---

## Gaps

- No source gives a buyer-holdings breakdown (stablecoin vs ETH/BTC balances). The only data point is Chainalysis's average of 26 tokens held per x402 payer, versus 4 for other Base wallets.
- I did not query Dune, Artemis, Allium, Nansen or Token Terminal directly; they require accounts or keys. Figures attributed to them come through TRM, the arXiv paper or press coverage.
- The Bazaar call counts come from CDP and cover only catalogued resources. "Implied spend" is listed price × calls, not settled amounts, and `upto` prices are ceilings.
