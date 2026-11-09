# Herald SDK on stock x402 middleware: composition check

Design under test: the provider runs the stock v2 server middleware (`@x402/hono`, `@x402/express`, `@x402/next`, `x402ResourceServer`) unchanged. Herald SDK supplies only (a) per-network `payTo` addresses derived through NEAR Chain Signatures (plain EVM `0x` address, plain Solana base58 key), (b) a helper that builds a multi-network `accepts` list of USDC options, and (c) a facilitator setup that sends each network to a facilitator that supports it. Funds land natively on each chain, and sweeping happens later, outside x402.

Builds on [x402.md](./x402.md) and [facilitators-and-sdk.md](./facilitators-and-sdk.md).

Sources and method:
- `x402-foundation/x402` at `main` = commit `9843d75` (2026-11-09), shallow clone. npm `@x402/*` 2.30.0. Paths below are relative to the repo root.
- Live `GET /supported` probes on 2026-11-09 at 22:03 UTC.
- Read-only `eth_call` against public RPCs (`cast call`) and one Solana `getMinimumBalanceForRentExemption` RPC.
- Three `POST /verify` calls carrying a dummy signature from `0x…0001`. Spec v2 §7.1 forbids state changes on `/verify`, and no key signed anything.
- Nothing was signed, sent, or spent.

Content was rephrased for compliance with licensing restrictions. "Inferred" marks conclusions drawn from code paths, not from docs or tests. "Unverified" marks claims I could not check.

---

## 1. Server config shape

### 1.1 Types (identical across all adapters)

All adapters take `RoutesConfig` from `@x402/core/server`. The types live in `typescript/packages/core/src/http/x402HTTPResourceServer.ts`:

| Type | Definition | Lines |
| - | - | - |
| `DynamicPayTo` | `(context: HTTPRequestContext) => string \| Promise<string>` | L110 |
| `DynamicPrice` | `(context: HTTPRequestContext) => Price \| Promise<Price>` | L115 |
| `PaymentOption` | `{ scheme: string; payTo: string \| DynamicPayTo; price: Price \| DynamicPrice; network: Network; maxTimeoutSeconds?: number; extra?: Record<string, unknown> }` | L153-160 |
| `RouteConfig` | `{ accepts: PaymentOption \| PaymentOption[]; resource?; description?; mimeType?; serviceName?; tags?; iconUrl?; customPaywallHtml?; unpaidResponseBody?; settlementFailedResponseBody?; extensions? }` | L168-208 |
| `RoutesConfig` | `Record<string, RouteConfig> \| RouteConfig` (a bare `RouteConfig` applies to every path) | L213 |

`Price` is `Money | { asset, amount, extra? }` (`typescript/packages/core/src/types/index.ts` L64-70).

**`payTo` and `price` can be sync or async functions.** `buildPaymentRequirementsFromOptions` awaits each one, per option, per request (`typescript/packages/core/src/server/x402ResourceServer.ts` L915-950, resolution at L930-933). `scheme`, `network`, `maxTimeoutSeconds`, and `extra` are static. The paid retry is matched by deep equality between `payload.accepted` and the requirements rebuilt for that request (`findMatchingRequirements` L1390-1427, `paymentRequirementsMatchAccepted` L2329-2349). Dynamic functions must therefore return the same value on the retry. Only scheme-declared `dynamicExtraFields` (e.g. SVM `recentBlockhash`) are excluded from that comparison.

### 1.2 Entry points per package

| Package | Function | Signature | File:lines |
| - | - | - | - |
| `@x402/hono` | `paymentMiddleware` | `(routes: RoutesConfig, server: x402ResourceServer, paywallConfig?, paywall?, syncFacilitatorOnStart = true): MiddlewareHandler` | `typescript/packages/http/hono/src/index.ts` L399-416 |
| | `paymentMiddlewareFromConfig` | `(routes, facilitatorClients?: FacilitatorClient \| FacilitatorClient[], schemes?: SchemeRegistration[], paywallConfig?, paywall?, syncFacilitatorOnStart = true)` | L443-462 |
| | `paymentMiddlewareFromHTTPServer` | `(httpServer: x402HTTPResourceServer, paywallConfig?, paywall?, syncFacilitatorOnStart = true)` | L126-131 |
| `@x402/express` | same three, same signatures | | `typescript/packages/http/express/src/index.ts` L495-516, L539-558, L128 |
| `@x402/next` | `paymentProxy(routes, server, paywallConfig?, paywall?, sync?)` (middleware.ts) | | `typescript/packages/http/next/src/index.ts` L189-200 |
| | `paymentProxyFromConfig(routes, facilitatorClients?, schemes?, …)` | | L228-247 |
| | `withX402(routeHandler, routes, server, paywallConfig?, paywall?, sync?)` (per route handler) | | L439-456 |
| | `withX402FromHTTPServer`, `paymentProxyFromHTTPServer` | | L279, L92 |
| core | `new x402ResourceServer(facilitatorClients?: FacilitatorClient \| FacilitatorClient[])` | | `x402ResourceServer.ts` L423-436 |
| | `.register(network: string, scheme)` (wildcards like `"eip155:*"` allowed) | | |
| | `buildPaymentRequirementsFromOptions(options, ctx)`, `verifyPayment`, `settlePayment` (public) | | L915, L1081, L1286 |

Hono, Express, and Fastify re-export `x402ResourceServer` and `x402HTTPResourceServer`. Next re-exports the same (`next/src/index.ts` L474-478). `HTTPFacilitatorClient` is imported from `@x402/core/server`. Server scheme helpers: `registerExactEvmScheme(server, { networks? })` registers `eip155:*` by default (`typescript/packages/mechanisms/evm/src/exact/server/register.ts` L35-47). `registerExactSvmScheme` registers `solana:*` (`svm/src/exact/server/register.ts` L28-38).

### 1.3 Minimal example: USDC on Base, Arbitrum, Optimism, and Solana

Written for this brief; not executed.

```ts
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";

const EVM_PAY_TO = "0x…";   // Chain Signatures, secp256k1 path; same address on every EVM chain
const SOL_PAY_TO = "…";     // Chain Signatures, ed25519 path
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const usdcEvm = (asset: `0x${string}`, amount: string) =>
  ({ asset, amount, extra: { name: "USD Coin", version: "2" } }); // domain verified on-chain, §5.1

const server = new x402ResourceServer([
  new HTTPFacilitatorClient({ url: "https://x402.dexter.cash", timeoutMs: 30_000 }),
  new HTTPFacilitatorClient({ url: "https://facilitator.payai.network", timeoutMs: 30_000 }),
])
  .register("eip155:*", new ExactEvmScheme())
  .register("solana:*", new ExactSvmScheme());

const app = new Hono();
app.use(paymentMiddleware({
  "GET /quote": {
    accepts: [
      { scheme: "exact", network: "eip155:8453",  payTo: EVM_PAY_TO, price: "$0.01" },
      { scheme: "exact", network: "eip155:42161", payTo: EVM_PAY_TO, price: "$0.01" },
      // Optimism has no default asset: "$0.01" throws here, so give an explicit AssetAmount.
      { scheme: "exact", network: "eip155:10", payTo: EVM_PAY_TO,
        price: usdcEvm("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "10000") },
      { scheme: "exact", network: SOLANA, payTo: SOL_PAY_TO, price: "$0.01" },
    ],
    description: "Quote", mimeType: "application/json",
  },
}, server));
```

Why Optimism needs the explicit form: `"$…"` resolves through `getDefaultAsset`. That function throws `No default asset configured for network …` for `eip155:10` (`typescript/packages/mechanisms/evm/src/defaultAssets.ts` L354-372; caller `exact/server/scheme.ts` L135-136). An `AssetAmount` is passed through as given (`scheme.ts` L72-83), and nothing fills in `extra.name`/`version`. The EVM client then throws if they are missing (`exact/client/eip3009.ts` L61-67), so the helper must set them.

### 1.4 Most composable helper shape

Return a `PaymentOption[]`, plus separate static `payTo` strings. The provider spreads the array into an existing `accepts`:

```ts
accepts: [...heraldAccepts({ evmPayTo, solPayTo, usd: "0.01", networks: [...] }), ...providerOwnOptions]
```

Reasons, from the code:
- `accepts` already takes an array, and options are independent (§1.1). Any adapter accepts a spread.
- Emit explicit `{ asset, amount, extra: { name, version } }` on every EVM chain, not `"$…"`. Output is then deterministic, works for non-default chains, and does not depend on the provider's money parsers.
- Use **precomputed static `payTo` strings**, not `DynamicPayTo`. Derivation is deterministic. A static string avoids an async call per option per request and any mismatch between the 402 and the retry (§1.1).
- Order matters. Stock buyers pick the first eligible entry (§6). Put the chains most buyers hold first, and let the provider reorder.
- The helper cannot add or drop networks per request. Options are fixed per route at construction (`x402HTTPResourceServer` normalizes `config.accepts` once). A different network set needs a different route or server.
- The helper must also tell the provider to register `eip155:*` and `solana:*` schemes. Otherwise route validation fails with `missing_scheme` (L1173-1187).

### 1.5 v1 packages (`x402-hono`, `x402-express` 1.2.0)

**No multi-network support.**
- `paymentMiddleware(payTo: Address | SolanaAddress, routes: RoutesConfig, facilitator?: FacilitatorConfig, paywall?)` (`typescript/packages/legacy/x402-hono/src/index.ts` L75-80; express identical).
- The v1 `RouteConfig` is `{ price; network; config? }`, with one network per route (`legacy/x402/src/types/shared/middleware.ts` L60-66).
- The middleware builds exactly one requirement, through an EVM-or-SVM branch (`x402-hono/src/index.ts` L129-190).
- A single `payTo` per middleware instance means EVM and Solana `payTo` cannot be mixed in one instance.
- The v1 network enum has **no `arbitrum` and no `optimism`** (`legacy/x402/src/types/shared/network.ts` L3-21).
- Maintainers froze the legacy packages and closed PRs adding networks to them (PR [#488](https://github.com/x402-foundation/x402/pull/488), closed 2025-12-29).
- So the Herald design is v2-only.

---

## 2. Facilitator composition

### 2.1 Exact behavior of `new x402ResourceServer([A, B, …])`

`initialize()` (`x402ResourceServer.ts` L717-784):
- Calls `getSupported()` on each client **sequentially, in array order**.
- For each `(x402Version, network, scheme)` it stores the first client that listed it. The code comment says earlier facilitators take precedence (L757-761).
- A client whose `getSupported()` throws is logged and skipped (L763-767).
- Init throws only if **no** client returned anything (L770-781).
- The stored `SupportedResponse` also supplies `kinds[].extra` to schemes. SVM `feePayer` therefore comes from the winning facilitator (`svm/src/exact/server/scheme.ts` L132-136).

When several facilitators list the same network:
- The first one is used for the 402 **and** for verify/settle (`getFacilitatorClient` L2151-2161; verify L1146-1151; settle L1568-1573).
- **There is no load balancing and no runtime failover.** If the mapped client throws, the error propagates. Only an `onVerifyFailure` or `onSettleFailure` hook that returns `{ recovered: true, result }` can override it (verify L1182-1209).
- The "try every facilitator" loop (verify L1155-1175, settle L1577-1602) runs only when **no** client is mapped for that kind. In practice that means the pair was never advertised (inferred).
- `settleWithPendingRetry` retries the **same** client once, and only on `settlement_pending` (L1764-1785).

When no facilitator lists a route's network:
- `x402HTTPResourceServer.initialize()` calls `validateRouteConfiguration`. That pushes a `missing_facilitator` error (`x402HTTPResourceServer.ts` L1234-1249) and throws `RouteConfigurationError` (L504-512).
- Every adapter attaches `attachBackgroundInitHandler` to the eager init promise. For `RouteConfigurationError` or `FacilitatorCapabilityError` it calls **`process.exit(1)`** (`typescript/packages/core/src/http/backgroundInit.ts` L14-16, L27-33; hono L139-144, express L141-146, next `utils.ts` L91-96, fastify L300-305).
- With `syncFacilitatorOnStart: false`, `buildPaymentRequirements` throws `Facilitator does not support …` on each request instead (`x402ResourceServer.ts` L859-864). Nothing catches it in the options loop (L928-947), so the whole 402 for that route fails (inferred).
- **Consequence: if the only facilitator for Optimism is down when the provider's process starts, the provider's whole server exits.** This combines the per-facilitator skip at L763-767 with the fatal route check (inferred, not tested).

### 2.2 Can a provider pass our composed list into the stock middleware?

Yes. `FacilitatorClient` is a three-method interface: `verify(payload, requirements)`, `settle(payload, requirements)`, `getSupported()` (`typescript/packages/core/src/http/httpFacilitatorClient.ts` L68-99). Both `x402ResourceServer` and `paymentMiddlewareFromConfig` accept one client or an array. Herald can ship either:

1. **An array of `HTTPFacilitatorClient`s**, optionally each wrapped to filter its `getSupported().kinds` to the networks Herald wants it to serve. The `only()` wrapper is in [facilitators-and-sdk.md §2](./facilitators-and-sdk.md). This is zero-risk and uses only stock precedence.
2. **One router object implementing `FacilitatorClient`** that dispatches by `requirements.network`. It can add what stock code lacks:
   - A **`getSupported()` that falls back to a last-known snapshot**, including the SVM `feePayer`, so one facilitator outage cannot trigger the `process.exit` in §2.1.
   - **EVM verify failover.** An EIP-3009 or Permit2 payload is not tied to a facilitator, so B can verify what A could not (inferred from the payload shape).
   - EVM settle failover is risky. If A broadcast and then timed out, B's resubmission reverts on the used nonce, and the result would read as a failure for a payment that landed. Fail over only on errors that clearly happened before broadcast (inferred).
   - **No Solana failover after the 402.** The buyer's transaction names A's `feePayer`, and B rejects it with `invalid_exact_svm_fee_payer_not_managed_by_facilitator` (`svm/src/exact/facilitator/scheme.ts` L810-820; errors.ts L14).

`HTTPFacilitatorClient` config: `url` (default `https://x402.org/facilitator`, L15), `timeoutMs` (default 90 s, L17). `createAuthHeaders` must be keyed by path (L39-61).

### 2.3 Existing router or failover packages

**None found.**
- npm search for "x402 facilitator router/failover/fallback/aggregator/multi facilitator" returned only `@x402/*`, `@coinbase/*`, `@circle-fin/x402-batching`, and `@payai/facilitator`. The last is a config for one facilitator.
- GitHub repo search: no results. Code search for `implements FacilitatorClient` found only single-facilitator clients and mocks.
- Repo issues: nothing on failover. [#2961](https://github.com/x402-foundation/x402/issues/2961) (closed) added timeouts. The official example presents the array form as redundancy (`examples/typescript/servers/hono/README.md` L237-243). Given §2.1, it only gives redundancy for `/supported` at init.

### 2.4 Live coverage (v2 `exact`, mainnet, 2026-11-09 22:03 UTC)

| Facilitator | Key? | Base | Arb | Polygon | Avalanche | Optimism | Solana | Notes |
| - | - | - | - | - | - | - | - | - |
| Dexter `x402.dexter.cash` | no | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Also BNB. `extra.assetTransferMethod: "permit2"` on EVM kinds. Solana `minPaymentAmountUsd` ≈ 0.00095 (new since the prior probe). Dummy `/verify` on Base and OP returned **503 `policy:price_unavailable`** twice, 20 s apart |
| PayAI `facilitator.payai.network` | no (1,000 free credits per `payTo`) | ✅ | ✅ | ✅ | ✅ | — | ✅ | Also BNB. Dummy `/verify` on Base returned `invalid_exact_evm_signature` (EIP-3009 path reached). OP returned `400 invalid_network` |
| Polygon `x402.polygon.technology` | no | — | — | ✅ | — | — | — | |
| Kobaru, OpenX402 | no | ✅ | — | — | — | — | ✅ | |
| Solvador | key for verify/settle | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Also NEAR |
| Daydreams | key | ✅ | — | — | — | — | ✅ | Also Ethereum |
| x402.org | no | testnets only: Base Sepolia, Solana devnet, Algorand/Aptos/Hedera/Stellar/XRPL testnets | | | | | | |
| CDP | key | 401 on `/supported` | | | | | | |
| Heurist | — | 502 | | | | | | |

Keyless coverage of all six chains: Dexter alone. PayAI covers five, with no Optimism. Optimism has a single keyless facilitator, so it is the chain most exposed to the §2.1 startup-exit problem.

**Unverified:** whether Dexter settles EIP-3009 payloads. Its `/supported` advertises `permit2`, the stock server ignores `kinds[].extra` on EVM (`evm/src/exact/server/scheme.ts` L111-125), and the probe was blocked by its 503 policy. If Dexter only takes Permit2, buyers would need a Permit2 approval, and the requirements would need `extra.assetTransferMethod: "permit2"`.

---

## 3. Solana `payTo` at a fresh address

- **The recipient ATA must already exist with the stock SDK.**
  - The TS client derives the destination ATA and emits only `TransferChecked` (`typescript/packages/mechanisms/svm/src/exact/client/scheme.ts` L83-105).
  - The facilitator simulates. On failure it looks up the destination ATA and returns `invalid_exact_svm_recipient_ata_missing` when that account is missing (`svm/src/exact/facilitator/scheme.ts` L1305-1336; `errors.ts` L87).
- **`extra.ataCreationRequired` is in the spec but not in the SDKs.**
  - Spec: `specs/schemes/exact/scheme_exact_svm.md` L81 (field), §5.4 L539-551 (rules), §5.5 L553-577 (advertisement).
  - The server sets it. The fee payer funds a `CreateIdempotent`. The sponsor must advertise `kinds[].extra.ataCreationSponsored: true`, and absence means false.
  - The spec landed in PR #3221 (merged 2026-10-26). The SDK implementation for TS, Go, and Python is PR [#3968](https://github.com/x402-foundation/x402/pull/3968), **still open**. At `main` no SDK file mentions `ataCreation` (grep).
  - **No live facilitator advertises `ataCreationSponsored`.** None of the probed Solana kinds carry it.
- **Fix: pre-create the ATA once.** `AssociatedTokenProgram.CreateIdempotent` takes any funding payer and does **not** need the owner's signature. So Herald or the provider can create each provider's USDC ATA from any SOL wallet, with no Chain Signatures call (standard SPL ATA behavior; not specific to x402).
- **Cost:** live `getMinimumBalanceForRentExemption(165)` returned **1,488,440 lamports (≈0.0015 SOL)**. The spec still says ≈0.002 SOL (L304, L541), the older 2,039,280-lamport figure. Why rent dropped is unverified. The rent stays in the account and can be reclaimed by closing it, but a closed ATA breaks the next payment.
- **USDC mint** `EPjFWdd5…Dt1v` is owned by the classic Token program (`TokenkegQ…`, live `getAccountInfo`), so ATA derivation uses Token, not Token-2022.
- **On-curve vs off-curve:** irrelevant to x402. Client and facilitator use `findAssociatedTokenPda({ owner: payTo, … })` with no curve check (client L89-93, facilitator L1246-1251; grep finds no `isOnCurve` in `svm/src` exact code). An ed25519 Chain Signatures key is an ordinary on-curve public key, so wallets and `@solana/spl-token`'s `allowOwnerOffCurve` guard also accept it.

## 4. EVM `payTo` at a fresh address

No issue found.
- EIP-3009 verify checks only that `getAddress(authorization.to) === getAddress(requirements.payTo)` (`evm/src/exact/facilitator/eip3009.ts` L247-256).
- Permit2 checks `witness.to` the same way (`permit2.ts` L131).
- `eth_getCode` is called on the **payer** only, for ERC-6492 and ERC-1271 classification (eip3009.ts L75, L162-217).
- The EVM error catalogue has no payTo-code, allowlist, or sanctions code (`exact/facilitator/errors.ts` L8-82).
- USDC itself does not restrict recipients beyond its blacklist.

Off-protocol checks:
- **CDP** runs KYT/OFAC screening that declines payments involving sanctioned or high-risk addresses ([CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator)). Whether it screens payTo, payer, or both is not stated.
- **mikedotexe/FastNEAR** keys are scoped to an approved `payTo` list ([facilitators-and-sdk.md](./facilitators-and-sdk.md) §1.1).
- Dexter and PayAI: no recipient checks documented (unverified).
- **PayAI** meters free credits per `payTo`. Each derived address gets its own 1,000 credits. After that, `/settle` returns `403 free_tier_exhausted` ([PayAI developers](https://facilitator.payai.network/developers.md)).

## 5. Gasless sweep from the derived address

### 5.1 EVM: EIP-3009 on every target chain (verified on-chain)

`cast call` of `name()`, `version()`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()`, `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()`, and `authorizationState(addr, nonce)` on native USDC:

| Chain | USDC | `name` / `version` | TWA typehash |
| - | - | - | - |
| Base 8453 | `0x833589fC…02913` | "USD Coin" / "2" | `0x7c7c6cdb…2267` ✅ |
| Arbitrum 42161 | `0xaf88d065…5831` | "USD Coin" / "2" | ✅ |
| Polygon 137 (native) | `0x3c499c54…3359` | "USD Coin" / "2" | ✅ |
| Avalanche 43114 | `0xB97EF9Ef…a6E` | "USD Coin" / "2" | ✅ |
| Optimism 10 (native) | `0x0b2C639c…Ff85` | "USD Coin" / "2" | ✅ |
| Ethereum 1 | `0xA0b86991…eB48` | "USD Coin" / "2" | ✅ |

The typehash equals `keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")`. So the derived EOA signs an EIP-712 `TransferWithAuthorization` (one Chain Signatures call), and **any** account can submit `transferWithAuthorization`. The derived address needs no native gas. `receiveWithAuthorization` requires `msg.sender == to`, which fits a contract destination.

Relayer options:
- **Own gas EOA per chain** calling USDC directly. This is the simplest and needs no third party. The stock `x402Facilitator` from `@x402/core/facilitator` plus `ExactEvmScheme` can serve as that relayer when self-hosted: build an `exact` payload `{from: derived, to: treasury}` and call its `settle` in-process. That needs gas on every chain ([facilitators-and-sdk.md](./facilitators-and-sdk.md) §3.1).
- **Third-party x402 facilitator `/settle` used as a relayer.** It works on the wire: `/settle` takes `{x402Version, paymentPayload, paymentRequirements}` (spec v2 §7), checks signature, balance, time window, and `to == payTo`, then submits. No resource or HTTP 402 is involved. Concerns:
  - It is not the facilitator's intended use.
  - PayAI would bill the destination's credits.
  - Dexter's pricing/policy layer can refuse (§2.4).
  - No ToS text addressing it was found (unverified).
  - Avoid declaring `bazaar` on such payloads.
  - Treat this as a fallback that needs the operators' consent.
- **Gelato, thirdweb Engine, Biconomy, Circle Gas Station:** generic sponsored-call relayers that can submit the same call (pricing and current availability not verified).
- **EIP-7702:** not needed for USDC, because 3009 already makes the transfer gasless. A 7702 batch still needs a relayer to send the type-4 transaction. Caveat (inferred, unverified per chain): once a derived EOA is 7702-delegated it has code. FiatToken v2.2 then validates authorizations through ERC-1271. Future x402 payments **to** it are unaffected, but its own 3009 sweeps would depend on the delegate's `isValidSignature`.

### 5.2 Solana

The derived key signs an SPL `TransferChecked` from its ATA (one EdDSA Chain Signatures call). A separate fee payer co-signs and pays the fee, which is standard Solana fee abstraction ([solana.com fee abstraction](https://solana.com/docs/payments/send-payments/payment-processing/fee-abstraction)). Options:
- Herald's own SOL fee-payer wallet.
- **Kora**, a Solana Foundation paymaster/JSON-RPC signer that can also back an x402 facilitator ([Kora docs](https://solana.com/docs/tools/kora/getting-started), [Kora x402 guide](https://solana.com/docs/tools/kora/guides/x402)).
- An x402 facilitator's `/settle` with its `feePayer`. The same abuse and ToS caveats apply, and the destination ATA must exist.
- Octane: not checked.

## 6. Buyer compatibility

Selection order (`typescript/packages/core/src/client/x402Client.ts` L777-847):
1. Registered scheme and network.
2. Known `paymentFlow`.
3. Spend controls.
4. Policies.
5. Prefer `authorization`.
6. Selector, default `accepts[0]` (L343).

**Selection ignores the buyer's balance.** `@x402/fetch` makes one payment attempt and does not fall back to another entry (`http/fetch/src/index.ts` L121-133). A buyer whose EVM signer is registered for `eip155:*` but who holds USDC only on Arbitrum will pick Base if Base comes first, and fail with insufficient funds. This is inferred from the code: no balance logic in the client, scheme, or fetch sources (grep).

Spend controls: by default an asset passes only if `scheme.findDefaultAsset(asset, network)` finds it (L878-891), and payments are capped at `$1` (L156). Default tables:

| Network | Default USD assets (`asset`) | Source |
| - | - | - |
| Base 8453 | USDC `0x833589fC…02913` | `evm/src/defaultAssets.ts` L41-49 |
| Ethereum 1 | USDC `0xA0b86991…eB48` | L59-67 |
| Avalanche 43114 | USDC `0xB97EF9Ef…a6E` | L68-76 |
| Polygon 137 | USDC (native) `0x3c499c54…3359` | L124-132 |
| Arbitrum 42161 | USDC `0xaf88d065…5831` | L133-141 |
| **Optimism 10** | **none** | not in table (L41-318) |
| **BNB 56** | **none** | not in table |
| Solana mainnet | USDC `EPjF…Dt1v`, USDT `Es9v…wNYB`, USDG, PYUSD, CASH | `svm/src/defaultAssets.ts` L27-56 |

So **Polygon and Avalanche USDC are allowed by default, and Optimism USDC is not.** A stock buyer on `@x402/core` ≥ 2.23 drops the OP entry unless it sets `allowedAssets` or `spendControls: false`. Maintainers point non-default chains to `registerMoneyParser` or `AssetAmount` (`DEFAULT_ASSETS.md` L3-5) rather than adding them to the table. No open PR adds `eip155:10`.

## 7. Where Chain Signatures `payTo` needs care, and what breaks "drop-in"

Special handling:
- **Offer & Receipt extension.** The simplest signer-authorization option signs with the `payTo` key (`specs/extensions/extension-offer-and-receipt.md` L240-243). With Chain Signatures that means an MPC round-trip per 402 and per 200, which is impractical. Use a dedicated key with `did:web` or DNS instead, as the docs recommend (`docs/extensions/offer-receipt.mdx` L46). EIP-712 offers require an EVM `payTo` (L52-55), so Solana entries need JWS.
- **Bazaar.** Listings embed `accepts` including `payTo`. Discovery can filter by `payTo` (`specs/extensions/bazaar.md` L442, L457; `docs/extensions/bazaar.mdx` L923). One address per provider groups cleanly. CDP Bazaar indexes only CDP-settled payments, so keyless facilitators keep listings out of the CDP catalog ([facilitators-and-sdk.md](./facilitators-and-sdk.md) §8).
- **`PAYMENT-RESPONSE`** carries `payer`, `transaction`, `network`, and `amount`, not `payTo`. It proves delivery to the derived address, not provider control of it.
- **`payment-identifier`** fingerprints include `payTo` (`specs/extensions/payment_identifier.md` L95-99). Keep addresses stable.
- **SIWX** binds the payer, not `payTo`. Not affected.

Things that break or degrade "drop-in compatible":
1. **Startup `process.exit(1)`** if any advertised network has no facilitator in `/supported` at init, including when that network's only facilitator is down at boot (§2.1). This is the most serious issue. Mitigate with a snapshot-backed `getSupported`.
2. **No runtime failover**, because the first facilitator listing a network owns it (§2.1). Solana is pinned to the `feePayer` facilitator by design.
3. **Optimism**: `"$…"` price throws server-side, and stock buyers drop the entry (§1.3, §6). The keyless option is Dexter alone.
4. **Solana ATA** must be pre-created. Sponsored creation exists in the spec only (§3).
5. **Balance-blind `accepts[0]`** on the buyer side (§6).
6. **v1 packages and v1-only buyers** cannot use multi-network `accepts` or Arbitrum/Optimism (§1.5).
7. **PayAI per-`payTo` free tier** ends with `403 free_tier_exhausted` (§4).
8. **Dexter** EVM transfer method (EIP-3009 vs Permit2) and its `price_unavailable` 503 policy are unverified (§2.4).
9. On Workers: `nodejs_compat` and `process.exit` caveats ([facilitators-and-sdk.md](./facilitators-and-sdk.md) §3.2-3.3).

## Unverified

- Dexter EIP-3009 acceptance, the meaning of its `policy:price_unavailable`, its ToS, and its recipient checks.
- Whether CDP KYT screens `payTo`.
- Third-party relayer pricing (Gelato, thirdweb, Biconomy, Circle). Octane status.
- Why Solana rent for 165 bytes is now 1,488,440 lamports.
- USDC FiatToken version per chain (ERC-1271 behavior after EIP-7702).
- Facilitator ToS on using `/settle` for sweeps.
