# Facilitators and the x402 v2 TypeScript SDK: facts for Herald

Scope: facts only, no design decisions. Herald = x402 gateway on Cloudflare Workers that returns `exact` USDC/USDT options on Base, Arbitrum, Polygon, Optimism, Ethereum, BNB, Avalanche, Solana, and maybe NEAR, with `payTo` = a provider's NEAR Intents PoA deposit address, then verifies/settles via a facilitator and proxies to the provider's upstream.

Builds on [x402.md](./x402.md). Sources: `x402-foundation/x402` at commit `9843d75` (2026-11-09; npm `@x402/*` 2.30.0, published 2026-11-04), docs.x402.org, facilitator docs, and live probes.

Probe method: on 2026-11-09 around 21:00 UTC I called each facilitator's public `GET /supported`. To learn whether a key is needed, I also sent `POST /verify` with an empty, invalid body (`{"x402Version":2,"paymentPayload":{},"paymentRequirements":{}}`). Spec v2 §7.1 says `/verify` must not write state, and no funds could move. Raw responses were saved to `/tmp/herald-sup/*.json` (not committed). Content was rephrased for compliance with licensing restrictions.

Chain IDs: Base `eip155:8453`, Arbitrum `eip155:42161`, Polygon `eip155:137`, Optimism `eip155:10`, Ethereum `eip155:1`, BNB `eip155:56`, Avalanche `eip155:43114`, Solana `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, NEAR `near:mainnet`.

---

## 1. Mainnet facilitators

### 1.1 Per-facilitator facts

The x402 docs list is at `docs/dev-tools/facilitators.md` L20-40. It says the list is selected and not exhaustive (L8), and that `x402.org` is not for mainnet routes (L14-18, L42).

| Facilitator | URL probed | `/supported` result (mainnet, v2 `exact`) | Key / account | Fees | Rate limits |
| - | - | - | - | - | - |
| **CDP (Coinbase)** | `api.cdp.coinbase.com/platform/v2/x402` | `401 Unauthorized`; `/supported` needs auth. The docs table lists Base, Polygon, Arbitrum, Monad, World, Solana ([CDP Facilitator](https://docs.cdp.coinbase.com/x402/network-support)) | Yes: CDP API key ID + secret, JWT bearer (`/verify` also 401) | First 1,000 on-chain tx/month free, then $0.001 per tx; verify free ([same page](https://docs.cdp.coinbase.com/x402/network-support)) | Standard CDP API limits, `429` on excess; SLO 99.9%, P95 settle 900 ms on Base ([CDP FAQ](https://docs.cdp.coinbase.com/x402/support/faq.md)) |
| **PayAI** | `facilitator.payai.network` | 200. v2 exact: Base, Arbitrum, Polygon, **BNB**, Avalanche, Solana, plus Sei, X Layer, SKALE Base. Also v1 `base, arbitrum, avalanche, polygon, solana, …`. Extensions: `bazaar`, `eip2612GasSponsoring`, `erc20ApprovalGasSponsoring` | No key to start. `/verify` returned 400 (validation), not 401 | 1,000 free credits per **receiving address (`payTo`)**; $1 = 1,000 credits; live `/supported` `pricing.rates`: Base $0.00179 (eip3009), Arbitrum $0.00559, Polygon $0.00365, Avalanche $0.00242, BNB $0.00424 (permit2), Solana $0.00112. When credits run out, `/settle` returns 403 `free_tier_exhausted` ([developers.md](https://facilitator.payai.network/developers.md)) | Per IP: settle 100 rps, verify/supported 200 rps, discovery 25 rps (same page) |
| **Dexter** | `x402.dexter.cash` | 200. v2 exact: Base, Arbitrum, Polygon, **Optimism**, **BNB** (18-decimals USDC), Avalanche, Solana, plus Monad, World, Robinhood, SKALE. Also a non-standard `bridge` scheme (Base↔Solana, `bridgeFeePercent: 0.1`) and `tab`. v1 also listed for the same chains. Some chains have a payment floor (`minPaymentAmountUsd`: World 0.0011, Monad 0.0022, Robinhood 0.0044; none on our chains) | No key. `/verify` returned 500 "No facilitator registered for scheme: undefined", with no auth error | No fee on settled payments ([facilitator.dexter.cash](https://facilitator.dexter.cash/)); x402 docs say no fees and no account (`facilitators.md` L27) | Not documented anywhere I could reach (the site is a JS app) |
| **Solvador** | `api.solvador.com` | 200. v2 exact: Base, Arbitrum, Optimism, Polygon, Avalanche, Solana, **NEAR**, plus Celo, Linea, Unichain, World, Monad, Robinhood, XRPL, Starknet. **No Ethereum, no BNB.** Default asset is USDC on every EVM chain except Robinhood (USDG) ([networks](https://docs.solvador.com/networks)) | Yes. `/verify` returned 401 "missing API key". Its llms.txt says verify needs no auth, but the docs page and the probe say it does ([api/verify](https://docs.solvador.com/api/verify)) | Free plan 10 settles/month; Starter $5 for 6,500; Pro $39 for 45,000; Max $229 for 260,000; pay-as-you-go 1,000 free then $0.001 ([plans](https://docs.solvador.com/platform/plans)) | Monthly quota; over quota, `/settle` returns 402 |
| **thirdweb** | `api.thirdweb.com/v1/payments/x402` | `401`: needs `x-secret-key` or `x-client-id` | Yes: secret key plus a thirdweb **server wallet** that executes transactions ([portal](https://portal.thirdweb.com/payments/x402/facilitator)) | 0.3% of each transaction through the facilitator ([pricing](https://thirdweb.com/pricing)) | Plan-based, 250 to 1,000 rps or unlimited (same page) |
| **Daydreams** | `facilitator.daydreams.systems` | 200. v2 exact: Base, **Ethereum** (`eip155:1`), Solana; `upto` on Base and Ethereum | Yes. `/verify` returned 401 "Valid Bearer token is required" | Not published | Not published. Open source: [daydreamsai/facilitator](https://github.com/daydreamsai/facilitator) (Node/Elysia) |
| **Heurist** | `facilitator.heurist.xyz` | **502** on three tries about 30 min apart | Landing page offers a Free plan and an Enterprise plan ([facilitator.heurist.ai](https://facilitator.heurist.ai/)) | n/a | Free 10 rps, 99% availability; Enterprise unlimited (same page) |
| **Corbits** | `facilitator.corbits.dev` | **NXDOMAIN**: no A or CNAME record via 1.1.1.1 or 8.8.8.8. docs.corbits.dev now describes an agent platform with no facilitator pages | n/a | n/a | n/a |
| **1Shot** | none found | No hosted public facilitator URL. 1Shot sells server-wallet APIs for running your own facilitator, with examples in FastAPI and n8n ([1shot-x402](https://github.com/uxlySoftware/1shot-x402), last push 2025-06-18) | Yes: 1Shot API key, secret, and a funded escrow wallet | n/a | n/a |
| **mikedotexe / FastNEAR** | `x402.mikedotexe.com` (NEAR), `base.x402.mikedotexe.com` (Base) | 200. NEAR host: `near:mainnet` only (signer `x402-relayer2.mike.near`, extension `payment-identifier`). Base host: `eip155:8453` v2 and `base` v1. One network and one asset (Circle USDC) per host | Yes. `/verify` returned 401 `invalid_api_key`. Keys are **manually reviewed**, requested via a public GitHub issue, and are valid only for the approved network, asset, and **recipient (payTo) list** ([reference-access.md](https://github.com/fastnear/x402-facilitator/blob/main/docs/reference-access.md)) | Facilitator fee 0; gas sponsorship bounded per client and per day | No SLA; "conservative" per-client limits |
| **x402.org** | `x402.org/facilitator` | 200, **testnets only**: Base Sepolia, Solana devnet, Algorand, Aptos, Hedera, Stellar, XRPL testnets | None | Free | n/a. Docs say not for mainnet (`facilitators.md` L42) |

Other facilitators, listed in the docs or found during research:

| Facilitator | Probe result | Notes |
| - | - | - |
| Polygon (`x402.polygon.technology`) | 200: v2 exact `eip155:137` (and v1 `polygon`) | `/verify` returned 400 (no auth gate). Docs: [Polygon x402](https://docs.polygon.technology/payment-services/agentic-payments/x402/intro/) |
| Celo (`api.x402.celo.org`) | 200: `eip155:42220` only | USDC, USDT, USAT via EIP-3009, plus regional stablecoins via Permit2. Listed in `/supported` `extra.supportedAssets` |
| X Pay (`facilitator-xpay.llc`) | 200: Base only | Merchant API key required (`/verify` 401) |
| Mogami (`facilitator.mogami.tech`) | 200: v1 `base` only | — |
| Meridian (`api.mrdn.finance/v1`) | 200: **v1 only**, but wide: arbitrum, avalanche, base, bsc, ethereum, optimism, polygon, solana, and more | `/verify` 401 (key) |
| Kobaru (`gateway.kobaru.io`) | 200: v2 Base, Solana, SKALE | `/verify` 400 (no auth gate). Not in the docs list |
| OpenX402 (`facilitator.openx402.ai`) | 200: v2 Base, Monad, Solana | `/verify` 200 with a validation error. Not in the docs list |
| x402.rs (`facilitator.x402.rs`) | 200: testnets only | — |
| HPP | 200: `eip155:190415` only | — |
| AlgoVoi, Fireblocks, Built on Stellar, FTP Canton, T54 XRPL, Sui (UIG), TRDEFI Arc | Not probed, or no `/supported` found at the listed host (AlgoVoi `/supported` 404, T54 `/supported` 404) | None covers chains on our list except AlgoVoi, whose site claims Base, Polygon, Arbitrum, OP, Solana, and more |
| Circle Facilitator Service | Not probed; production settle needs a Circle key | USDC on Arc, Base, Polygon, per a [third-party summary](https://dev.to/scriptmasterlabs01/which-payment-networks-support-the-x402-protocol-the-facilitator-lists-re-probed-46bn) |

### 1.2 Tokens (USDC vs USDT)

- `/supported` lists networks, not tokens (spec v2 §7.3). The x402 docs say any ERC-20 can work on any EVM facilitator via EIP-3009 or Permit2 ([Networks & Token Support](https://docs.x402.org/core-concepts/network-and-token-support), repo L364-366). CDP says the same for its networks ([CDP Facilitator](https://docs.cdp.coinbase.com/x402/network-support)).
- Tokens without EIP-3009 need Permit2. The buyer must make a one-time on-chain approval, which costs native gas unless the facilitator supports `eip2612GasSponsoring` / `erc20ApprovalGasSponsoring` ([DEFAULT_ASSETS.md](https://github.com/x402-foundation/x402/blob/main/DEFAULT_ASSETS.md) L60-76).
- PayAI on BNB: Binance-Peg USDC `0x8AC7…580d` and USDT `0x5539…7955`, both 18 decimals, Permit2 only, v2 only. The payer needs BNB for the first approval ([PayAI networks](https://docs.payai.network/x402/supported-networks)). PayAI's pricing table prices `permit2` only on Base and BNB; Arbitrum, Polygon, and Avalanche are priced for `eip3009` only (live `/supported` `pricing.rates`).
- Dexter `/supported` `extra` names "USD Coin" as the EIP-712 domain on our EVM chains and tags them `assetTransferMethod: permit2`. The TS server scheme ignores `kinds[].extra` on EVM (`typescript/packages/mechanisms/evm/src/exact/server/scheme.ts` L111-125), so this field is informational.
- **SDK default assets matter for buyers** (see §7.3). The TS EVM default-asset table has USDC for Base, Ethereum, Avalanche, Polygon, and Arbitrum. It has **no entry for Optimism (`eip155:10`) or BNB (`eip155:56`)** and no USDT on any of our EVM chains (`typescript/packages/mechanisms/evm/src/defaultAssets.ts` L41-318). SVM defaults include USDC and USDT (`Es9vMFrz…`) (`typescript/packages/mechanisms/svm/src/defaultAssets.ts` L30-56). NEAR default is USDC `17208628…` (`typescript/packages/mechanisms/near/src/defaultAssets.ts` L15).

### 1.3 Matrix: network × facilitator (mainnet v2 `exact`)

✅ = in live `/supported` (or the docs table, for CDP and thirdweb); v1 = v1 only; — = not listed.

| Network | CDP 🔑 | PayAI | Dexter | Solvador 🔑 | Daydreams 🔑 | mikedotexe 🔑 | thirdweb 🔑 | Polygon | Meridian 🔑 |
| - | - | - | - | - | - | - | - | - | - |
| Base | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (base host) | ✅ (docs) | — | v1 |
| Arbitrum | ✅ | ✅ | ✅ | ✅ | — | — | ✅ (docs) | — | v1 |
| Polygon | ✅ | ✅ | ✅ | ✅ | — | — | ✅ (docs) | ✅ | v1 |
| Optimism | — | — | ✅ | ✅ | — | — | ✅ (docs) | — | v1 |
| Ethereum | — | — | — | — | ✅ | — | ✅ (docs) | — | v1 |
| BNB | — | ✅ (Permit2) | ✅ | — | — | — | not verified | — | v1 |
| Avalanche | — | ✅ | ✅ | ✅ | — | — | ✅ (docs) | — | v1 |
| Solana | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ (docs) | — | v1 |
| NEAR | — | — | — | ✅ | — | ✅ | — | — | — |

🔑 = API key or account required. thirdweb's `/supported` is gated, so its column comes from docs claiming "170+ EVM chains" and Solana ([portal](https://portal.thirdweb.com/payments/x402/facilitator), [Solana changelog](https://portal.thirdweb.com/changelog/solana-x402-support-is-live)).

### 1.4 Coverage with no API key

- **Dexter alone** covers 7 of 9: Base, Arbitrum, Polygon, Optimism, BNB, Avalanche, Solana. No keyless facilitator found covers Ethereum mainnet or NEAR.
- **PayAI** is keyless and covers 6 of 9 (no Optimism, Ethereum, or NEAR). It adds no chain beyond Dexter, only a second keyless option on 6 chains. Its free tier is 1,000 credits per `payTo`, then a merchant account.
- With keys: **Dexter + Solvador** covers 8 of 9 (adds NEAR). Adding **Daydreams** (or thirdweb) brings Ethereum, for 9 of 9. Solvador alone covers 7 of 9 (no Ethereum, no BNB).
- mikedotexe's NEAR key is scoped to an approved recipient list. That does not fit per-provider deposit addresses unless each address is registered (from its reference-access doc).

---

## 2. One resource server, several facilitators

Yes. `x402ResourceServer` accepts one `FacilitatorClient` or an array (`typescript/packages/core/src/server/x402ResourceServer.ts` L423-436).

How routing works (same file):

- `initialize()` calls `getSupported()` on each client **in array order**. For every `(x402Version, network, scheme)` in each response, it stores the first client that listed it: "earlier facilitators in the array get precedence" (L711-783).
- `verifyPayment` and `settlePayment` look up that client with `getFacilitatorClient(version, network, scheme)` (L2152-2162). If no client is mapped, they try each client in order (L1146-1180 verify, ~L1568-1600 settle).
- `buildPaymentRequirements` **throws** if no facilitator's `/supported` lists the option's network and scheme ("Facilitator does not support … on …", L852-864). An `accepts` entry for a network no facilitator advertises therefore breaks the whole 402 for that route. That is inferred from `buildPaymentRequirementsFromOptions` looping without a catch (L915-950).
- The examples present the array form as redundancy (`examples/typescript/servers/hono/README.md` L237-243).

API (`HTTPFacilitatorClient` config at `typescript/packages/core/src/http/httpFacilitatorClient.ts` L25-62; default URL `https://x402.org/facilitator` L15; default timeout 90 s L17):

```ts
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

// Optional: pin a facilitator to specific networks by filtering its /supported.
const only = (inner: FacilitatorClient, networks: string[]): FacilitatorClient => ({
  verify: (p, r) => inner.verify(p, r),
  settle: (p, r) => inner.settle(p, r),
  getSupported: async () => {
    const s = await inner.getSupported();
    return { ...s, kinds: s.kinds.filter(k => networks.includes(k.network)) };
  },
});

const dexter = new HTTPFacilitatorClient({ url: "https://x402.dexter.cash", timeoutMs: 30_000 });
const solvador = new HTTPFacilitatorClient({
  url: "https://api.solvador.com",
  // must be keyed by path, not a flat header object (L40-62)
  createAuthHeaders: async () => {
    const h = { "X-API-Key": SOLVADOR_KEY };
    return { verify: h, settle: h, supported: h };
  },
});

const server = new x402ResourceServer([dexter, only(solvador, ["near:mainnet"])])
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());
```

`FacilitatorClient` is an interface with `verify`, `settle`, and `getSupported` (`httpFacilitatorClient.ts` L68-99), so a custom router class is also possible. `getSupported()` retries 3 times on 429 with backoff (L101-102), so one slow facilitator delays init for all of them (see #2157 in §3.3).

---

## 3. Self-hosted facilitator on Workers

### 3.1 What it needs

From `examples/typescript/facilitator/basic/index.ts` (deps: `@x402/core`, `@x402/evm`, `@x402/svm`, `viem`, `@solana/kit`, `@scure/base`) and [Networks & Token Support → Running your own](https://docs.x402.org/core-concepts/network-and-token-support) (L343-353: an RPC per network, a wallet with native gas, the facilitator code):

- `x402Facilitator` from `@x402/core/facilitator`, with `.register(network, scheme)` per network and hooks `onBeforeVerify`, `onAfterSettle`, and so on (example L103-136).
- **EVM**: `toFacilitatorEvmSigner({...})` wraps **one viem wallet client, bound to one chain**. It needs `getCode`, `readContract`, `verifyTypedData`, `writeContract`, `sendTransaction`, and `waitForTransactionReceipt` (example L50-94; `typescript/packages/mechanisms/evm/src/signer.ts` L215-227). The default receipt wait is 180 s (`signer.ts` L199). For 7 EVM chains you need 7 clients, 7 RPC URLs, and native gas on each chain (ETH on Base, Arbitrum, OP, and Ethereum; POL; BNB; AVAX). `ExactEvmScheme` facilitator options include `eip6492AllowedFactories` (example L126-130).
- **Solana**: `toFacilitatorSvmSigner(keypairSigner, { defaultRpcUrl })` (example L96-101), with SOL in the fee-payer account. Confirmation polls `getSignatureStatuses` over HTTP RPC, not WebSocket (`typescript/packages/mechanisms/svm/src/signer.ts` ~L452-475).
- **NEAR**: `@x402/near` relayer account with NEAR for gas plus 1 yocto per transfer (see [x402.md](./x402.md) §2.5).
- Concurrency state is **in-memory by default**. The SVM duplicate-settlement guard `SettlementCache` is a `Map` (`typescript/packages/mechanisms/svm/src/settlement-cache.ts` L12-31). Core `InMemoryPendingSettlementStore` is a `Map` (`typescript/packages/core/src/facilitator/pendingSettlementStore.ts` L29, L81-82). The basic example uses no viem `nonceManager`; the batch-settlement and auth-capture examples do. On Workers each isolate has its own memory, so these guards and any EVM nonce tracking are not shared across isolates. That is an inference from the code; no doc addresses it.

### 3.2 Node built-ins in the code paths

From a grep of `src/` excluding tests:

| Package / path | Node dependency |
| - | - |
| `@x402/core` base64 | Uses `btoa`/`atob` when present, else `Buffer` (`typescript/packages/core/src/utils/index.ts` L193-219). Fine on Workers |
| `@x402/hono` settle path | `Buffer.from(await res.arrayBuffer())` with no guard (`typescript/packages/http/hono/src/index.ts` L318). The `Buffer` global needs `nodejs_compat` on Workers |
| `@x402/extensions/bazaar` | Imports `node:url` (`domainToASCII`) in `bazaar/facilitator.ts` L10, re-exported from `bazaar/index.ts` L130. `@x402/hono` dynamically imports `@x402/extensions/bazaar` when any route declares `bazaar` (hono `index.ts` L168-186) |
| `@x402/core` init handler | Calls `process.exit(1)` on fatal init errors (`typescript/packages/core/src/http/backgroundInit.ts` L28-33). Behavior on workerd not tested |
| `@x402/evm` batch-settlement file storage | `node:fs`, `node:path`, `node:crypto`. Only under the `./batch-settlement/*/file-storage` subpaths (`typescript/packages/mechanisms/evm/package.json` exports) |
| `@x402/svm` batch-settlement | `Buffer` (channelManager, scheme). Not used by `exact` |
| `@x402/near` | `Buffer` only if defined, else fallback (`typescript/packages/mechanisms/near/src/utils.ts` L219-240) |
| `@x402/evm` exact / `@x402/svm` exact | No Node built-ins found. Deps: `viem`, `zod` / `@solana/kit`-family, `@noble/hashes` (npm `@x402/evm@2.30.0` and `@x402/svm@2.30.0` dependencies) |

Facilitator-side Bazaar validation (`validateDiscoveryExtension`) always calls `ajv.compile` → `new Function()`. Workers disallow that at request time. Issue [#3446](https://github.com/x402-foundation/x402/issues/3446) is open; a comment says the server-startup half was fixed by #3648 but the facilitator side is still broken.

### 3.3 Known Workers issues (x402 repo)

- [#3029](https://github.com/x402-foundation/x402/issues/3029) (open) and [#3556](https://github.com/x402-foundation/x402/issues/3556) (closed): Bazaar route validation ran `ajv.compile()` and logged warn/error pairs on Workers. It was non-fatal. Fixed in `@x402/extensions` **2.29.0**, which skips the startup check where code generation is disallowed (`typescript/packages/extensions/CHANGELOG.md`, entry for #3648).
- [#3446](https://github.com/x402-foundation/x402/issues/3446) (open): the same Ajv issue on the consumer/facilitator side. The reporter ran `compatibility_flags: ["nodejs_compat"]`.
- [#2157](https://github.com/x402-foundation/x402/issues/2157) (open): `syncFacilitatorOnStart: true` (hono default, `index.ts` L139) makes each cold isolate wait for facilitator `/supported` before its first 402. Reports: about 14 s cold init, and 20-40 s hangs during a Cloudflare incident because of the 429 retry loop. Turning the flag off is not a clean fix: `buildPaymentRequirements` needs the supported map (comments; proposed PR #2221 not merged; current code still throws, `x402ResourceServer.ts` L852-864).
- [#3035](https://github.com/x402-foundation/x402/issues/3035) (open): an empty-body-after-settlement report on `@x402/hono` (Node). The current code rebuilds the Response from the buffered bytes on success (`index.ts` L334-350).
- Cloudflare's own `@x402/hono` v2 example (`cloudflare/agents/examples/x402`) sets `compatibility_flags: ["nodejs_compat"]` and uses `@x402/core`, `@x402/evm`, `@x402/fetch`, `@x402/hono` ^2.17. Cloudflare's `x402-proxy-template` still uses **v1** `x402-hono@1.0.0` with no compat flags (read via `gh api` from `cloudflare/agents` and `cloudflare/templates`). Cloudflare docs examples point at `x402.org/facilitator` ([CF x402](https://developers.cloudflare.com/agents/tools/payments/x402)).
- Third-party Workers facilitator: [0xKoda/x402-facilitator](https://github.com/0xKoda/x402-facilitator) (Base USDC, EIP-3009; last push 2025-10-28).

---

## 4. Hono middleware and dynamic requirements

- **`@x402/hono` exists**, version 2.30.0, deps `@x402/core`, `@x402/extensions`, peer `hono >=4.13.7 <5` (`typescript/packages/http/hono/package.json`). Exports: `paymentMiddleware(routes, server, paywallConfig?, paywall?, syncFacilitatorOnStart=true)`, `paymentMiddlewareFromHTTPServer(httpServer, …)`, `paymentMiddlewareFromConfig(routes, facilitatorClients, schemes, …)`, and `setSettlementOverrides` (`index.ts` L119-470). The legacy v1 package is `x402-hono` 1.2.1.
- Workers: Cloudflare ships a v2 Hono example with `nodejs_compat` (§3.3). From source, the settle path needs the `Buffer` global, and Bazaar routes pull in `node:url`, so both need `nodejs_compat`.
- **The middleware buffers the whole upstream response** (`await res.arrayBuffer()`, `index.ts` L318) before settling and responding. Streaming is not preserved.

### Dynamic price and payTo

Types are in `typescript/packages/core/src/http/x402HTTPResourceServer.ts`:

- `DynamicPayTo = (ctx: HTTPRequestContext) => string | Promise<string>` (L110)
- `DynamicPrice = (ctx: HTTPRequestContext) => Price | Promise<Price>` (L115); `Price = Money | { asset, amount, extra? }` (`types/index.ts` L64-70)
- `PaymentOption { scheme; payTo: string | DynamicPayTo; price: Price | DynamicPrice; network; maxTimeoutSeconds?; extra? }` (L153-160)
- `HTTPRequestContext { adapter, path, method, paymentHeader?, routePattern?, decodedPath? }` (L270-277). The adapter offers `getHeader`, `getMethod`, `getPath`, `getUrl`, `getQueryParams?`, `getQueryParam?` (L57-75).
- Functions run per request, for every option, both when building the 402 and on the paid retry (`buildPaymentRequirementsFromOptions`, `x402ResourceServer.ts` L928-946; called from `processHTTPRequest` L598).

```ts
app.use(paymentMiddleware({
  "GET /p/:provider/*": {
    accepts: [
      { scheme: "exact", network: "eip155:8453",
        payTo: ctx => depositAddressFor(ctx.path, "eip155:8453"),
        price: ctx => ({ asset: USDC_BASE, amount: priceFor(ctx.path, "base"),
                         extra: { name: "USD Coin", version: "2" } }) },
      { scheme: "exact", network: "eip155:42161",
        payTo: ctx => depositAddressFor(ctx.path, "eip155:42161"),
        price: ctx => ({ asset: USDC_ARB, amount: priceFor(ctx.path, "arb"),
                         extra: { name: "USD Coin", version: "2" } }) },
    ],
    description: "…", mimeType: "application/json",
  },
}, server));
```

Limits found in the code:

- Route keys are fixed when the middleware is built. Patterns support `*`, `:param`, and `[param]` (`parseRoutePattern`, L1412-1437).
- The **set of options and each option's `network`/`scheme` are static per route**. Only `payTo` and `price` are functions. Dropping a chain for one provider needs a separate route, a separate `x402HTTPResourceServer`, or calling `x402ResourceServer` directly: `buildPaymentRequirements`, `createPaymentRequiredResponse`, `verifyPayment`, and `settlePayment` are public (`x402ResourceServer.ts` L834, L963, L1081, L1286).
- The paid retry is matched by deep equality between `payload.accepted` and the requirements rebuilt for that request (see [x402.md](./x402.md) §1.5). Dynamic functions must return the same values on retry.
- `onProtectedRequest` can grant access or abort with 403 before payment processing (type L240, registration L533, loop L561-577).

---

## 5. Settlement order

The order is set per entry by `extra.paymentFlow` (spec v2 §6.1, `specs/x402-specification-v2.md` L289-298; phase table `typescript/packages/core/src/server/paymentFlow.ts` L18-34):

| Flow | Order |
| - | - |
| `authorization` (default for `exact`) | verify → handler → settle |
| `upfront` | settle → handler (no `/verify`) |
| `escrow` | settle → handler → settle |

- `exact` server schemes declare support for **`authorization` and `upfront`** on EVM (`eip3009` and `permit2`), SVM, and NEAR. The default is `authorization` (`typescript/packages/mechanisms/evm/src/exact/server/scheme.ts` L20-23; `svm/src/exact/server/scheme.ts` L30-32; `near/src/exact/server/scheme.ts` L31-33). EVM `upfront` arrived in `@x402/evm` 2.24.0 (CHANGELOG, #3240; npm 2026-08-27). Opt in per option: `extra: { paymentFlow: "upfront" }`. The server must then put `paymentFlow` on the wire (spec L291).
- In `processHTTPRequest`, when `phases.settleBeforeHandler` is true the SDK settles **before** returning `payment-verified`, and returns a 402 if that settle fails (`x402HTTPResourceServer.ts` L718-745). The Hono handler (`next()`, which could be the upstream proxy) runs only after a successful settle. So **"settle first, then proxy" is supported** with `upfront`.
- Alternatively, under `authorization` a custom middleware can call the public `httpServer.processSettlement(...)` (L792) itself before fetching upstream. The built-in Hono middleware does not do this.
- Spec consequence of `upfront`: if the handler fails, the client has paid and received nothing. `exact` defines no refund (`specs/schemes/exact/scheme_exact.md` L18-20).
- Client side: when both `authorization` and `upfront`/`escrow` entries remain, the TS client keeps only the `authorization` entries (`typescript/packages/core/src/client/x402Client.ts` L835-843; spec L291 says clients SHOULD prefer `authorization`). Clients must skip flows they do not recognize; the TS client recognizes `authorization`, `upfront`, and `escrow` (L803-817).

Under `authorization` (Hono `index.ts`):

- If the handler throws or returns status ≥ 400, settlement is cancelled and nothing is charged (L264-305; `onVerifiedPaymentCanceled` reasons `handler_threw`, `handler_failed`, per [Lifecycle hooks](https://docs.x402.org/advanced-concepts/lifecycle-hooks) L20).
- If the handler succeeded but **settle fails**, the middleware replaces the response with the 402/settlement-failed response. The client does not get the body, but **the upstream has already done the work** (L325-345). A facilitator boundary error becomes 502 and any other thrown error becomes `402 {}` (L358-366).
- `onSettleFailure` can return `{ recovered: true, result }` to override (lifecycle hooks L19). `RouteConfig.settlementFailedResponseBody` customizes the body (`x402HTTPResourceServer.ts` L204). `settlement_pending` gets one settle retry, then counts as unresolved ([x402.md](./x402.md) §1.6; [CDP FAQ](https://docs.cdp.coinbase.com/x402/support/faq.md)).

---

## 6. v1 vs v2

Usage data:

- **Sellers, CDP Bazaar** (33,279 resources pulled 2026-11-10, method in [x402-market.md](./x402-market.md) L39): 33,067 resources (**99.4%**) are `x402Version: 2` and 212 are v1. Over the last 30 days, v2 listings had 783,825 paid calls and v1 listings 8,789 (**98.9% v2**). This is my own count from `/tmp/bz/p*.json`, using `quality.l30DaysTotalCalls`. The Bazaar only indexes resources settled through CDP, so it is biased toward CDP sellers.
- **Sellers, open web** (June 2026): a live probe of 146 mainnet hosts found about 77% still emitting v1 network strings like `"base"`. This was measured by host, not volume ([SmartFlow, 2026-06-17](https://smartflowproai.substack.com/p/x402-is-growing-fast-three-quarters)).
- **Buyers**: I found no measurement of buyer-side version share. A v2 resource can only be paid with a v2 payload, so Bazaar paid-call counts suggest most CDP-settled buyer traffic is v2. That is an inference.
- Signals: CDP calls v2 recommended and says v1 still works ([CDP migration](https://docs.cdp.coinbase.com/x402/migration-guide)). x402scan reportedly rejects v1 origins ([dev.to](https://dev.to/ukenal/migrating-a-live-x402-service-from-v1-to-v2-on-base-mainnet-1mg9)). Several facilitators still list v1 kinds: PayAI, Dexter, Daydreams, mikedotexe-Base, Polygon, Meridian (v1 only), Mogami (v1 only). NEAR `exact` is v2 only. PayAI BNB is v2 only.

Can one server answer in both versions?

- The v2 HTTP transport spec anticipates a "dual-version endpoint" and says its CORS lists must name both `X-PAYMENT` and `PAYMENT-SIGNATURE`, and both `X-PAYMENT-RESPONSE` and `PAYMENT-RESPONSE` (`specs/transports-v2/http.md` L195-201).
- The **TS v2 server SDK does not serve v1**. `extractPayment` reads only `PAYMENT-SIGNATURE` (`x402HTTPResourceServer.ts` L1307-1320), even though the Hono adapter also captures `x-payment` into `context.paymentHeader` (hono `index.ts` L196). The 402 body defaults to `{}` or `{error}` (L1369-1386).
- Wire compatibility exists. The v2 client reads the `PAYMENT-REQUIRED` header first and falls back to a JSON body with `x402Version: 1` (`typescript/packages/core/src/http/x402HTTPClient.ts` ~L120-140). It sends `X-PAYMENT` for v1 payloads (L94-104). The `@x402/evm` and `@x402/svm` client registration helpers also register v1 networks (`evm/src/exact/client/register.ts` L82-93, `svm/src/exact/client/register.ts` L52-65). So one 402 can carry a v2 header and a v1 body. With the stock SDK, the v1 body (via `unpaidResponseBody`, L194) and `X-PAYMENT` handling would be custom code. That is inferred, not documented.

---

## 7. Amounts and client selection

### 7.1 Amount per entry

Each `PaymentRequirements` entry has its own required `amount` (spec v2 §5.1.2). In the SDK each `PaymentOption` has its own `price`, static or dynamic (§4). One 402 can therefore say 0.15 USDC on Base and 0.01 on Arbitrum.

### 7.2 Default selector

`x402Client` filters in this order (`typescript/packages/core/src/client/x402Client.ts` L762-845):

1. Registered network and scheme.
2. Known `paymentFlow`.
3. Spend controls.
4. Registered policies, in order.
5. Prefer `authorization`.
6. Selector.

The default selector is `accepts[0]` (L342-343). **It ignores price; server order decides.** Hooks:

- `new x402Client(selector)` or `x402Client.fromConfig({ paymentRequirementsSelector, policies, spendControls, schemes })` (L315, L353-362).
- `registerPolicy((version, reqs) => reqs.filter(...))` (L414; its doc comment shows "prefer cheaper" and "prefer network" examples, L401-411).
- The MCP guide shows a selector that picks by network (`docs/guides/mcp-server-with-x402.mdx` L236). The Go batch-settlement docs show `RegisterPolicy(batch.PaymentPolicy())` (`docs/schemes/batch-settlement.mdx` L924).
- I found no built-in "cheapest" selector, and no evidence of which selectors buyers commonly use.

### 7.3 Spend controls (since `@x402/core` 2.23.0, 2026-08-18)

- By default only assets in each mechanism's `DEFAULT_ASSETS` are payable, capped at **$1 per payment** (`x402Client.ts` L156, L858-898; [DEFAULT_ASSETS.md](https://github.com/x402-foundation/x402/blob/main/DEFAULT_ASSETS.md) L44-46).
- Entries for unlisted assets are dropped unless the buyer sets `allowedAssets` (a list, or `true`) or `spendControls: false`.
- Per §1.2, a stock v2 buyer (≥2.23, defaults) drops Herald entries for **USDC on Optimism, anything on BNB, and USDT on every EVM chain**. Base, Arbitrum, Polygon, Avalanche, and Ethereum USDC remain, plus Solana USDC/USDT and NEAR USDC.

---

## 8. Bazaar listing

General (x402 docs, `docs/extensions/bazaar.mdx`):

- A facilitator that supports `bazaar` may expose `/discovery/resources`. A resource becomes discoverable when its route declares the `bazaar` extension (L20). Any facilitator can run its own catalog (L22). PayAI, Solvador, Dexter, and mikedotexe advertise their own.
- Facilitators may report the outcome in an `EXTENSION-RESPONSES` header with `success`, `processing`, or `rejected` (L24-59).
- Parameterized routes collapse into one entry via `routeTemplate`, and `*` segments become `:varN`. A bare `*` gets no template (L456-466).
- `resource.serviceName`, `tags` (up to 5), and `iconUrl` enrich listings; invalid fields are silently dropped (L470-541).
- With `@x402/*` packages: declare via `declareDiscoveryExtension()` from `@x402/extensions/bazaar`. Hand-rolled schemas fail crawler checks ([migration guide](https://docs.x402.org/guides/migration-v1-to-v2) L315). `@x402/hono` auto-registers `bazaarResourceServerExtension` when any route declares `bazaar` (hono `index.ts` L168-186).

**CDP Bazaar** ([Get discovered](https://docs.cdp.coinbase.com/x402/seller/get-discovered.md)):

- **There is no form or registration call.** A resource is indexed after a **successful paid settlement through the CDP Facilitator** for an endpoint that advertises Bazaar metadata. Indexing takes up to 15 min. Listing therefore requires a CDP API key, and only covers networks CDP settles: Base, Polygon, Arbitrum, Monad, World, Solana.
- `createX402Server` from `@coinbase/cdp-sdk/x402` adds a minimal declaration automatically for every `"METHOD /path"` route. With the x402 Foundation packages it is opt-in per route.
- The settle call must carry `paymentPayload.extensions.bazaar` and `paymentPayload.resource`.
- CDP rejects verify/settle when `resource.description` is over 500 characters (same page; issues #2785 and #2789).
- Metadata is screened for prompt-injection text, at indexing and again later.
- `POST https://api.cdp.coinbase.com/platform/v2/x402/validate` checks reachability, the 402, and the bazaar block, and needs **no key**.
- Removal: after 30 days without a settlement, or when the endpoint stops returning 402. Health probes down-rank and then de-feature curated endpoints.
- Ranking uses 30-day usage and listing quality and is recomputed every 6 h. Results are **capped per domain**. Path segments that are bare UUIDs, EVM or Solana addresses, or tx hashes are normalized into one entry.
- Curation (featured tier) is editorial and needs mainnet live payments, ≥99% availability, and complete schemas.
- The `x402.org` facilitator keeps a separate catalog that is not the CDP Bazaar.

The CDP discovery list `GET /platform/v2/x402/discovery/resources` was readable without a key on 2026-11-10 ([x402-market.md](./x402-market.md) L39).

---

## Open items (not verified)

- thirdweb, CDP, Solvador, and Daydreams `/settle` behavior and token lists beyond docs. Their `/supported` or verify are gated.
- Dexter rate limits and SLA. Heurist network list (endpoint down during probes).
- Whether `process.exit` in `@x402/core` `backgroundInit.ts` misbehaves on workerd.
- Whether USDT on Arbitrum, Polygon, Optimism, and Avalanche (USDT0 / bridged) implements EIP-3009. Not checked; it determines EIP-3009 vs Permit2.
- Whether `@coinbase/x402` / `@coinbase/cdp-sdk` auth (uses `jose` and `axios`) runs on Workers.
