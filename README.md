# Herald

Herald lets API Providers accept x402 payments on many chains with the stock x402 libraries. Payments land in Receiving Addresses controlled by one NEAR account, the Provider Account, and the Provider Sweeps them later. See [`GLOSSARY.md`](./GLOSSARY.md) for terms and [`docs/adr/`](./docs/adr/) for decisions.

## Repository layout

| Path                   | What it is                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `apps/web`             | Provider dashboard: TanStack Start on Cloudflare Workers, shadcn/ui, Tailwind v4. |
| `apps/facilitator`     | Herald's x402 facilitator: Hono on Cloudflare Workers.                            |
| `packages/core`        | Business logic, and the Zod schemas that define domain types.                     |
| `packages/db`          | Drizzle tables and D1 migrations (Drizzle 1.0 RC, see ADR-0007).                  |
| `packages/x402`        | `@hrld/x402`, the npm package Providers install. Bundles the core code it needs.  |
| `examples/weather-api` | Example Provider API on Workers.                                                  |

## Development

Requirements: Node.js 22.18 or later and the [Vite+](https://viteplus.dev) CLI (`vp`). Vite+ downloads the pinned pnpm version itself.

```bash
vp install              # install dependencies; also generates worker-configuration.d.ts per Worker
vp check                # format, lint and type check the whole workspace
vp check --fix          # same, fixing formatting and autofixable lint issues
vp test                 # run every test (Workers tests run in the Cloudflare Vitest pool; core's are in packages/core/vite.workers.config.ts)
vp run ready            # check, test and build everything
vp -C packages/core run test:live  # check the network registry and MPC root keys against live chains
```

### Run locally

```bash
vp run db:migrate:local         # apply D1 migrations to the local database
vp -C apps/facilitator run dev  # facilitator on http://localhost:8787 (GET /health)
vp -C apps/web dev              # dashboard on http://localhost:3000 (GET /api/health)
```

`vp run dev` starts every app at once. Both Workers keep local D1 and KV state in `.wrangler/state` at the repo root, so they share one local database, as they share one database per environment when deployed.

The facilitator needs its gas wallet secrets locally: copy `apps/facilitator/.dev.vars.example` to `.dev.vars` and fill in throwaway testnet keys.

### Facilitator

`apps/facilitator` serves the x402 v2 facilitator API on the stock `@x402/core` facilitator and `exact` mechanisms:

| Endpoint         | Auth                         | What it does                                                                                                                                                                          |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /supported` | none                         | Lists every network Herald has in its environment, Solana with Herald's fee payer.                                                                                                    |
| `POST /verify`   | `Authorization: Bearer hk_…` | Verifies a payment into the key's Provider's own Receiving Address. 120 requests per minute per key.                                                                                  |
| `POST /settle`   | `Authorization: Bearer hk_…` | Settles it with Herald paying gas, and records the payment. 60 requests per minute per key, counted before the body is checked. Refused if the MPC root keys don't match `v1.signer`. |

Refusals come back as `{ "error": "…", "message": "…" }` with 400, 401 (missing, unknown, revoked or wrong-environment key), 403 (`payTo` isn't the Provider's), 429 or 503. EVM transactions go through one `EvmChainQueue` Durable Object per network, which owns the gas wallet's nonce and never submits the same EIP-3009 authorization twice. It also keeps settlements whose receipt didn't arrive within `SETTLE_RECEIPT_TIMEOUT_MS` (30 s), so the stock resource server's single `settlement_pending` retry, on any isolate, waits for the same transaction instead of failing.

Solana payments settle with the stock `@x402/svm` `exact` mechanism. The Buyer signs a USDC transfer with Herald's gas wallet as fee payer, and one `SolanaChainQueue` Durable Object per network adds the fee payer's signature and sends it. It signs only as fee payer, never a transaction whose instructions use the gas wallet's account, and never sends the same transaction signature twice. A payment only lands in a Receiving Address that has a USDC token account, so the same queue creates one per Provider when it registers (paying the rent) and records the result on the Provider (`solana_token_account_status`: `not_queued`, `queued`, `created` or `failed`). The web Worker queues it through a cross-Worker Durable Object binding. Until it exists, `/verify` and `/settle` answer `invalid_exact_svm_recipient_ata_missing` and nothing is sent.

Secrets per environment: `EVM_GAS_KEY` (0x hex private key, one gas wallet for every EVM chain), `SOLANA_GAS_KEY` (base58 64-byte secret key, funded with SOL for fees and token account rent) and `SOLANA_RPC_URL` (the Solana network's JSON-RPC endpoint). EVM endpoints are the `RPC_URLS` var in `apps/facilitator/wrangler.jsonc`. Solana's is a secret because `api.devnet.solana.com` and `api.mainnet-beta.solana.com` refuse requests from Workers (they block on the `CF-Worker` header, locally too), so it has to be an RPC vendor's URL (Helius, QuickNode, …), which usually carries an API key.

To get a Provider and an API key without the dashboard:

```bash
vp -C apps/facilitator run seed alice.testnet                # local D1
vp -C apps/facilitator run seed alice.testnet --env testnet  # herald-testnet D1
```

It prints the Provider's Receiving Addresses and an `hk_test_` key, once. Locally it also queues the Provider's Solana USDC token account, so run the facilitator first. On testnet the token account is queued at the Provider's first dashboard sign-in.

### Dashboard

`apps/web` is the Provider dashboard. Open it (`vp -C apps/web dev`, then http://localhost:3000), click **Connect NEAR wallet**, pick a wallet and sign the message it shows. Use a `.testnet` account on the testnet deployment and locally. Signing sends no transaction. You land on Overview, which shows your Provider Account, your EVM Receiving Address (one address for every EVM chain Herald lists) and your Solana Receiving Address, each with a copy button. Signed-out visitors to a dashboard page are sent to sign-in.

**API keys** lists your keys with their prefix, environment, creation time, last settlement and revocation. **Create key** issues an `hk_test_` key on testnet (`hk_live_` on mainnet) and shows it once; Herald keeps only its SHA-256 hash. **Revoke** stops a key at once: the facilitator answers its next request with 401 `revoked_api_key`. **Integration** shows a Node.js server for Hono and for Express, ready to paste: the stock `HTTPFacilitatorClient` pointed at Herald's facilitator with the key from `HERALD_API_KEY`, and `accepts()` filled in with your Provider Account.

Sign-in uses NEP-413 through `@hot-labs/near-connect`:

1. The server issues a single-use nonce, valid for 5 minutes, kept in D1 (`sign_in_nonces`).
2. The wallet signs Herald's message, the nonce and the dashboard's host as recipient.
3. The server checks the ed25519 signature and asks NEAR RPC (`NEAR_RPC_URL`) whether the key is a full-access key of the account. Function-call keys are refused.
4. The first sign-in registers the Provider, stores its Receiving Addresses and queues its Solana USDC token account with the facilitator's `SolanaChainQueue` (the `SOLANA_CHAIN_QUEUE` binding, `script_name` the facilitator Worker). If the queue can't be reached, sign-in still succeeds and the next sign-in tries again. Overview shows the token account's status. Locally, run the facilitator alongside the dashboard. A session goes into the `SESSIONS` KV namespace for 7 days, keyed by the SHA-256 of a random token held in an HTTP-only cookie. Signing out deletes it.

`SIGN_IN_RATE_LIMITER` allows 20 sign-in requests per minute per client IP. The logic lives in `packages/core/src/server` (`sign-in.ts`, `sessions.ts`); `apps/web/src/server/auth.ts` wires it to TanStack Start server functions.

### Pay the example API

```bash
vp -C apps/facilitator run seed <provider-account>   # put the key in examples/weather-api/.dev.vars
vp -C apps/facilitator run dev                        # facilitator on :8787
vp -C examples/weather-api run dev                    # weather API on :8788 (HERALD_FACILITATOR_URL=http://localhost:8787)
curl -i http://localhost:8788/weather                 # 402 with a PAYMENT-REQUIRED header
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy                           # pays on Base Sepolia
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy --network eip155:421614   # pays on Arbitrum Sepolia
BUYER_SOLANA_KEY=… vp -C examples/weather-api run buy --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1  # pays on Solana Devnet
```

Set `PROVIDER_ACCOUNT` in `examples/weather-api/wrangler.jsonc` to the seeded account. The Buyer needs testnet USDC ([Circle faucet](https://faucet.circle.com)) and no ETH or SOL; the facilitator's EVM gas wallet needs Sepolia ETH on each chain, and its Solana gas wallet devnet SOL. `BUYER_SOLANA_KEY` is a base58 64-byte secret key. Set `SOLANA_RPC_URL` in `apps/facilitator/.dev.vars` to a devnet endpoint from an RPC vendor. If both dev servers fail to start together, give them different `--inspector-port` values.

After changing a `wrangler.jsonc`, run `vp run -r types` to regenerate binding types (`wrangler types --env-interface CloudflareBindings`). Hono apps type their bindings as `new Hono<{ Bindings: CloudflareBindings }>()`; `env` from `cloudflare:workers` is typed through `Cloudflare.Env`, which Wrangler declares with the same bindings. After changing `packages/db/src/schema.ts`, run `vp run db:generate` to write a new migration.

### Deploy

`CLOUDFLARE_ENV` picks the Wrangler environment to deploy. Each environment sets a `HERALD_ENV` var (`testnet` or `mainnet`), the Herald environment, which the code reads through `HeraldEnvSchema` in core. Local dev and tests use the top-level config, where `HERALD_ENV` is `testnet`.

| `CLOUDFLARE_ENV` | `HERALD_ENV` | Facilitator                  | Web                  | D1               | KV (`SESSIONS`)           |
| ---------------- | ------------ | ---------------------------- | -------------------- | ---------------- | ------------------------- |
| `testnet`        | `testnet`    | `herald-facilitator-testnet` | `herald-web-testnet` | `herald-testnet` | `herald-sessions-testnet` |
| `production`     | `mainnet`    | `herald-facilitator-mainnet` | `herald-web-mainnet` | `herald-mainnet` | `herald-sessions-mainnet` |

The D1 databases and KV namespaces already exist; their IDs are in `apps/facilitator/wrangler.jsonc` and `apps/web/wrangler.jsonc` (IDs are not secrets). Sign in once with `npx wrangler login`, then:

```bash
vp run db:migrate:testnet   # apply D1 migrations to herald-testnet
vp run deploy:testnet       # deploy the facilitator, then the web app
```

For mainnet use `db:migrate:production` and `deploy:production`. Inside an app, the scripts read `CLOUDFLARE_ENV` and refuse to run without it, for example `CLOUDFLARE_ENV=testnet vp -C apps/facilitator run deploy`. The facilitator deploys first because the web app will bind to its Durable Objects (ADR-0006).

Secrets (gas wallet keys, the 1Click JWT) never go in the repo. Set them per environment with `CLOUDFLARE_ENV=<testnet|production> npx wrangler secret put <NAME>` from the Worker's directory, and keep local values in a gitignored `.dev.vars`.

### Known workarounds

| Where                                      | Workaround                                                                                                         | Why                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                      | `vite` overridden to the Vite+ core alias, and `peerDependencyRules` allow any `vite` version.                     | [Vite+ #2806](https://github.com/voidzero-dev/vite-plus/issues/2806): the alias reports version 1.5.x, so plugins that peer on `vite@^8` fail the check. |
| `vite.config.ts` (root, `test.projects`)   | `apps/web` is not a test project.                                                                                  | [workers-sdk #15969](https://github.com/cloudflare/workers-sdk/issues/15969): Vitest fails to start when the config loads `@cloudflare/vite-plugin`.     |
| `apps/facilitator`, `examples/weather-api` | Run and deploy with Wrangler directly, not through Vite. The facilitator's `vite.config.ts` only configures tests. | Keeps `@cloudflare/vite-plugin` out of every Vitest config (same issue).                                                                                 |
| `packages/*`, `apps/facilitator`           | Workers tests use `@cloudflare/vitest-plugin`, not `@cloudflare/vitest-pool-workers`.                              | The pool-workers package only supports Vitest 4; Vite+ ships Vitest 5. The renamed plugin supports both.                                                 |
| `packages/core`                            | Two test configs: `vite.config.ts` (Node.js) and `vite.workers.config.ts` (Workers pool, D1 and KV).               | The opt-in live checks read the host's environment variables, which the Workers pool doesn't see.                                                        |
| `packages/tsconfig.x402-dts.json`          | The `@hrld/x402` declaration build uses a tsconfig in `packages/`, not in `packages/x402`.                         | tsgo writes declarations for files outside `--rootDir` next to their sources, which would litter `packages/core/src`.                                    |

[Vite+ #1671](https://github.com/voidzero-dev/vite-plus/issues/1671) (React duplicated in SSR) and [#2481](https://github.com/voidzero-dev/vite-plus/issues/2481) (dev server wedges after a restart) did not show up while setting up `apps/web` on vite-plus 1.5.1. If the dashboard dev server stops answering after a config change, restart `vp dev`.
