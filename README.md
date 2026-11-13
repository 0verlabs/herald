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

Both Workers need their secrets locally: copy `apps/facilitator/.dev.vars.example` and `apps/web/.dev.vars.example` to `.dev.vars` next to them, and fill in throwaway testnet keys and your QuickNode testnet endpoints.

### Facilitator

`apps/facilitator` serves the x402 v2 facilitator API on the stock `@x402/core` facilitator and `exact` mechanisms:

| Endpoint         | Auth                         | What it does                                                                                                                                                                          |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /supported` | none                         | Lists every network Herald has in its environment, Solana with Herald's fee payer, and Herald's NEAR relayer under `signers["near:*"]`.                                               |
| `POST /verify`   | `Authorization: Bearer hk_…` | Verifies a payment into the key's Provider's own Receiving Address. 120 requests per minute per key.                                                                                  |
| `POST /settle`   | `Authorization: Bearer hk_…` | Settles it with Herald paying gas, and records the payment. 60 requests per minute per key, counted before the body is checked. Refused if the MPC root keys don't match `v1.signer`. |

Refusals come back as `{ "error": "…", "message": "…" }` with 400, 401 (missing, unknown, revoked or wrong-environment key), 403 (`payTo` isn't the Provider's), 429 or 503. EVM transactions go through one `EvmChainQueue` Durable Object per network, which owns the gas wallet's nonce and never submits the same EIP-3009 authorization twice. It also keeps settlements whose receipt didn't arrive within `SETTLE_RECEIPT_TIMEOUT_MS` (30 s), so the stock resource server's single `settlement_pending` retry, on any isolate, waits for the same transaction instead of failing.

Solana payments settle with the stock `@x402/svm` `exact` mechanism. The Buyer signs a USDC transfer with Herald's gas wallet as fee payer, and one `SolanaChainQueue` Durable Object per network adds the fee payer's signature and sends it. It signs only as fee payer, never a transaction whose instructions use the gas wallet's account, and never sends the same transaction signature twice. A payment only lands in a Receiving Address that has a USDC token account, so the same queue creates one per Provider when it registers (paying the rent) and records the result on the Provider (`solana_token_account_status`: `not_queued`, `queued`, `created` or `failed`). The web Worker queues it through a cross-Worker Durable Object binding. Until it exists, `/verify` and `/settle` answer `invalid_exact_svm_recipient_ata_missing` and nothing is sent.

NEAR payments (NEAR on mainnet and NEAR Testnet, listed first in each environment; ADR-0009) settle with the stock `@x402/near` `exact` mechanism. The Buyer signs a NEP-366 delegate action holding one USDC `ft_transfer` into the Provider's NEAR Receiving Address (an implicit account derived on `near-1`, ADR-0009), and needs no NEAR. One `NearChainQueue` Durable Object per network holds the relayer key, wraps the delegate action in a relayer transaction with the next relayer nonce, sends it and waits until it is final (up to `SETTLE_RECEIPT_TIMEOUT_MS`), outside the nonce lock. It remembers every signed delegate action it was given, so presenting one again, from any isolate, is refused instead of relayed. The payment is recorded with the Buyer's NEAR account and the relayer transaction's hash. A Receiving Address must exist and be registered on USDC (`storage_deposit`) before payments into it pass `/verify`; until then they answer `invalid_exact_near_recipient_not_registered_for_storage`. Herald sets it up at its own cost: every sign-in of a Provider whose NEAR Receiving Address isn't set up yet (`near_setup_status` not `created`) queues a setup job on `NearChainQueue`, whose alarm sends two relayer transactions, each only if the chain doesn't show it done: a 0.002 NEAR transfer that creates the implicit account, and `storage_deposit` on USDC (0.00125 NEAR, `registration_only`). The facilitator's Cron Trigger (every 10 minutes, `triggers.crons` in its `wrangler.jsonc`) queues the setup of up to 50 Providers per run that are `not_queued`, so Providers registered before NEAR are set up without signing in again. A failed attempt is retried after 30 s, 1, 2, 5 and 10 min; after six the Provider goes back to `not_queued`, and the next scheduled run or sign-in queues it again. The facilitator never sets an account up while verifying or settling a payment. Overview shows the status next to the NEAR address.

Facilitator secrets per environment:

| Secret                                               | What it is                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EVM_GAS_KEY`                                        | 0x hex private key, one gas wallet for every EVM chain.                                                                       |
| `SOLANA_GAS_KEY`                                     | base58 64-byte secret key, funded with SOL for fees and token account rent.                                                   |
| `BASE_RPC_URL`, `SOLANA_RPC_URL`, `ARBITRUM_RPC_URL` | JSON-RPC endpoint of each chain, for the environment's network (Base Sepolia, Solana Devnet and Arbitrum Sepolia on testnet). |
| `POLYGON_RPC_URL`, `AVALANCHE_RPC_URL`               | Mainnet only.                                                                                                                 |
| `NEAR_RPC_URL`                                       | NEAR testnet or mainnet, for the MPC root-key check and NEAR settlements.                                                     |
| `NEAR_RELAYER_KEY`                                   | `ed25519:` and a base58 64-byte secret key: the NEAR relayer, an implicit account. `scripts/near-relayer-wizard.sh` makes it. |

Every RPC endpoint is a private QuickNode URL, which carries the API key, so all of them are secrets. Solana's public endpoints wouldn't work anyway: `api.devnet.solana.com` and `api.mainnet-beta.solana.com` refuse requests from Workers (they block on the `CF-Worker` header, locally too). The web Worker needs `NEAR_RPC_URL` for sign-in and for reading Sweep signatures, and the same `<CHAIN>_RPC_URL` secrets as the facilitator for Overview's live balances and for following Sweeps (EVM receipts; Solana blockhashes, accounts and signature statuses).

To get a Provider and an API key without the dashboard:

```bash
vp -C apps/facilitator run seed alice.testnet                # local D1
vp -C apps/facilitator run seed alice.testnet --env testnet  # herald-testnet D1
```

It prints the Provider's Receiving Addresses and an `hk_test_` key, once. Locally it also queues the Provider's Solana USDC token account, so run the facilitator first. On testnet the token account is queued at the Provider's first dashboard sign-in.

### Dashboard

`apps/web` is the Provider dashboard. Open it (`vp -C apps/web dev`, then http://localhost:3000), click **Connect NEAR wallet**, pick a wallet and sign the message it shows. Use a `.testnet` account on the testnet deployment and locally. Signing sends no transaction. You land on Overview, which shows your Provider Account, your EVM Receiving Address (one address for every EVM chain Herald lists) and your Solana Receiving Address, each with a copy button. Signed-out visitors to a dashboard page are sent to sign-in.

Overview also shows the live USDC balance of your Receiving Addresses on each chain, read from that chain's RPC (`<CHAIN>_RPC_URL`) after the page loads. A chain whose RPC fails or takes over 8 s shows as unavailable without hiding the others. Below it, **Revenue** totals the payments Herald settled for you per chain, over the last 7 days and all time. **Payments** lists every settled payment, newest first, 25 per page: time, chain, amount, Buyer address, resource URL and the transaction, linked to the chain's block explorer. The queries live in `packages/core/src/server` (`payments.ts`, `balances.ts`); `apps/web/src/server/overview.ts` and `payments.ts` wire them to server functions.

**API keys** lists your keys with their prefix, environment, creation time, last settlement and revocation. **Create key** issues an `hk_test_` key on testnet (`hk_live_` on mainnet) and shows it once; Herald keeps only its SHA-256 hash. **Revoke** stops a key at once: the facilitator answers its next request with 401 `revoked_api_key`. **Integration** shows a Node.js server for Hono and for Express, ready to paste: the stock `HTTPFacilitatorClient` pointed at Herald's facilitator with the key from `HERALD_API_KEY`, a server scheme for `near:*`, `eip155:*` and `solana:*`, and `accepts()` filled in with your Provider Account. A server that doesn't want NEAR passes `networks` to `accepts()` without it and drops the `near:*` scheme. Below it, a Node.js Buyer with the stock `@x402/fetch` client registers each chain family only when its key is set, and says to set the NEAR key only with USDC on NEAR, since NEAR is listed first.

Sign-in uses NEP-413 through `@hot-labs/near-connect`:

1. The server issues a single-use nonce, valid for 5 minutes, kept in D1 (`sign_in_nonces`).
2. The wallet signs Herald's message, the nonce and the dashboard's host as recipient.
3. The server checks the ed25519 signature and asks NEAR RPC (`NEAR_RPC_URL`) whether the key is a full-access key of the account. Function-call keys are refused.
4. The first sign-in registers the Provider, stores its Receiving Addresses, queues its Solana USDC token account with the facilitator's `SolanaChainQueue` and its NEAR Receiving Address setup with the facilitator's `NearChainQueue` (the `SOLANA_CHAIN_QUEUE` and `NEAR_CHAIN_QUEUE` bindings, `script_name` the facilitator Worker). If a queue can't be reached, sign-in still succeeds and the next sign-in tries again; for NEAR, the facilitator's scheduled run does too. Overview shows the status of both. Locally, run the facilitator alongside the dashboard. A session goes into the `SESSIONS` KV namespace for 7 days, keyed by the SHA-256 of a random token held in an HTTP-only cookie. Signing out deletes it.

`SIGN_IN_RATE_LIMITER` allows 20 sign-in requests per minute per client IP. The logic lives in `packages/core/src/server` (`sign-in.ts`, `sessions.ts`); `apps/web/src/server/auth.ts` wires it to TanStack Start server functions.

**Sweep** moves USDC from a Receiving Address to any address on the same chain: the EVM one on Base or Arbitrum (plus Polygon and Avalanche on mainnet), the Solana one on Solana. Pick a chain, enter an amount and a destination, and the page shows what will happen: the destination receives the full amount, with no fee. The button stays disabled below the chain's minimum, above your balance, or once 10 Sweeps went out in the last 24 hours. **Sweep with NEAR wallet** then:

1. Plans the Sweep (`planSweep` in `packages/core/src/server/sweeps.ts`): it checks the destination, the minimum in the `sweep_minimums` table, the daily cap and the balance, then builds the payload.
   - EVM: the EIP-712 hash of an EIP-3009 `transferWithAuthorization` from the Receiving Address to the destination, valid for 10 minutes.
   - Solana: an SPL `TransferChecked` from the Receiving Address's USDC token account to the destination's, with Herald's Solana gas wallet as fee payer (`packages/core/src/server/solana-sweeps.ts`). If the destination has no USDC token account, the transaction creates it first, with Herald paying the rent. The destination must be a wallet, not a token account. The transaction uses a recent blockhash, so it must be signed within about a minute.
2. Asks your wallet to call `sign` on the MPC signer (`v1.signer-prod.testnet` on testnet, `v1.signer` on mainnet) with the payload as `payload_v2`, 1 yoctoNEAR and 50 Tgas: `{ Ecdsa: <hash> }` with path `ethereum-1` and domain 0 on EVM, `{ Eddsa: <transaction message> }` with path `solana-1` and domain 1 on Solana. The wallet must hold the Provider Account you signed in with.
3. Sends the NEAR transaction hash to the server (`completeSweep`). Herald reads the signature from that transaction over `NEAR_RPC_URL`, never from the browser, and checks it against your Receiving Address for the planned payload: ECDSA recovery on EVM, Ed25519 verification of the message on Solana. A signature that doesn't match fails the Sweep.
4. Submits the signed transfer through the facilitator's chain queue for the chain (`submitSweep` over the `EVM_CHAIN_QUEUE` or `SOLANA_CHAIN_QUEUE` cross-Worker binding), which pays the gas. The `SolanaChainQueue` adds the fee payer's signature only to a transaction that is a Sweep and uses the gas wallet for nothing but the fee and that token account rent, and has the node simulate it before sending. Submitting the same Sweep again answers the same transaction hash or signature without sending anything.

The Sweeps table follows each Sweep through `planned → awaiting_signature → submitted → confirmed | failed`, with links to the NEAR and chain transactions. While one is unfinished the page refreshes every 3 s (`refreshSweeps`): it reads the signature if it wasn't on NEAR yet, then whether the transfer landed over `<CHAIN>_RPC_URL` (the receipt on EVM, the signature status on Solana). An EVM Sweep never signed within its 10 minutes fails, as does one whose transfer reverted or the chain queue refused. A Solana Sweep fails if it isn't signed in time, if the transaction failed or the queue refused it, or if it hasn't landed once Solana is past the blockhash's last valid block height. Minimums are seeded from `docs/research/stack-and-minimums.md`: 0.15 USDC on Base (1Click's minimum there), 0.001 USDC elsewhere; testnet networks mirror their mainnet counterparts.

**Cross-chain and NEAR Intents Sweeps** (mainnet only: 1Click has no testnet, so on testnet the page offers same-chain Sweeps only). Under **To**, pick **Another chain** to receive USDC at an address on another Herald chain, or **NEAR Intents** to have USDC credited to your Provider Account inside `intents.near`, as the source chain's USDC token. **Get 1Click quote** plans the Sweep with a live 1Click quote (`requestQuote` in `packages/core/src/server/sweeps.ts`, client in `one-click.ts`):

- The quote is `EXACT_INPUT` from the source chain's USDC, with `recipientType: DESTINATION_CHAIN` (your address) or `INTENTS` (your Provider Account), and `refundTo` set to the source Receiving Address. Herald asks for a 30-minute deadline.
- The page shows what you will receive (and the least, after 0.5% slippage), 1Click's fee, the minimum, the time estimate, the refund fee and a countdown to sign. The transfer must be signed 10 minutes before 1Click's deadline at the latest, so it lands before the deposit address goes inactive: within 10 minutes on EVM, about a minute on Solana. Once the countdown runs out, **Get a fresh quote** plans a new Sweep, and the old one fails as unsigned.
- An amount below 1Click's minimum for the route is refused with the minimum 1Click names. So is a route where 1Click would keep more than 10% of the Sweep if it refunded (`MAX_REFUND_FEE_PERCENT`): from Solana 1Click keeps about 0.22 USDC, so Sweeps from Solana through 1Click start at about 2.21 USDC. The message names the least amount.
- **Sign with NEAR wallet** signs and submits the transfer as for a same-chain Sweep, but to 1Click's deposit address. A quote you discard, replace or let expire is never listed: the Sweeps table shows a 1Click Sweep only once your wallet sent its signing transaction, and a discarded quote can't be signed later.

After the transfer confirms, `refreshSweeps` follows `GET /v0/status` on 1Click for the deposit address: `confirmed → delivering → delivered | refunded`, or `failed` if 1Click gives up. If 1Click still hasn't seen the deposit an hour after the quote's deadline (`ONE_CLICK_PICKUP_GRACE_SECONDS`), the Sweep fails with the deposit address to give NEAR Intents support. A swap 1Click is already delivering keeps being followed. The table links the swap on the NEAR Intents explorer and, for a cross-chain Sweep, the delivery transaction. 1Click quotes without a key. An optional partner key lowers its fee on some routes: set it with `CLOUDFLARE_ENV=production wrangler secret put ONE_CLICK_JWT` in `apps/web`. It is deliberately left out of `secrets.required`, because `wrangler deploy` refuses to deploy without a required secret.

### Admin

`/admin` is for Herald admins: the NEAR account ids in the web Worker's `HERALD_ADMINS` var, comma-separated (`"ops.near, alice.near"`), set per environment in `apps/web/wrangler.jsonc` and locally in `.dev.vars`. It ships empty, so nobody is an admin until you set it. Everyone else, signed in or not, gets a 404, from the page and from its server functions. Admins see an **Admin** link in the dashboard header.

**Gas wallets** lists Herald's gas wallet on each chain of the environment: the address the facilitator's chain queue holds the key for, and its native balance (ETH, SOL, POL, AVAX) read from `<CHAIN>_RPC_URL`. A wallet below its threshold in `GAS_LOW_BALANCE_THRESHOLDS` (whole tokens per CAIP-2 network) is flagged **Low**; a network without a threshold never warns. **Sweep minimums** lists the `sweep_minimums` rows of the environment. **Edit** changes a row's minimum (in USDC) and note, checked with `SweepMinimumEditSchema` in the browser and on the server, and stamps it updated; the next Sweep planned uses it. The logic lives in `packages/core/src/server` (`admin.ts`, `balances.ts`); `apps/web/src/server/admin.ts` wires it.

### Pay the example API

```bash
vp -C apps/facilitator run seed <provider-account>   # put the key in examples/weather-api/.dev.vars
vp -C apps/facilitator run dev                        # facilitator on :8787
vp -C examples/weather-api run dev                    # weather API on :8788 (HERALD_FACILITATOR_URL=http://localhost:8787)
curl -i http://localhost:8788/weather                 # 402 with a PAYMENT-REQUIRED header
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy                           # pays on Base Sepolia
BUYER_PRIVATE_KEY=0x… vp -C examples/weather-api run buy --network eip155:421614   # pays on Arbitrum Sepolia
BUYER_SOLANA_KEY=… vp -C examples/weather-api run buy --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1  # pays on Solana Devnet
BUYER_NEAR_ACCOUNT=… BUYER_NEAR_KEY=ed25519:… vp -C examples/weather-api run buy --network near:testnet  # pays on NEAR Testnet
```

Set `PROVIDER_ACCOUNT` in `examples/weather-api/wrangler.jsonc` to the seeded account. The Buyer needs testnet USDC ([Circle faucet](https://faucet.circle.com)) and no ETH or SOL; the facilitator's EVM gas wallet needs Sepolia ETH on each chain, and its Solana gas wallet devnet SOL. `BUYER_SOLANA_KEY` is a base58 64-byte secret key. On NEAR the Buyer is a testnet account (`BUYER_NEAR_ACCOUNT`) with one of its full-access keys (`BUYER_NEAR_KEY`), and the facilitator needs `NEAR_RELAYER_KEY`; `examples/weather-api/README.md` has the NEAR demo step by step. The script registers a client scheme only for the `--network` it pays on: a stock client pays with the first Payment Option it has a scheme for, without checking the balance, and NEAR is listed first, so a Buyer registers `near:*` only if it holds USDC on NEAR. If both dev servers fail to start together, give them different `--inspector-port` values.

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

Secrets (gas wallet keys, RPC endpoints, the 1Click JWT) never go in the repo. Set them per environment with `CLOUDFLARE_ENV=<testnet|production> npx wrangler secret put <NAME>` from the Worker's directory, and keep local values in a gitignored `.dev.vars`.

The NEAR relayer's key (`NEAR_RELAYER_KEY` on the facilitator) comes from a wizard that creates the relayer, funds it and sets the secret: `scripts/near-relayer-wizard.sh testnet`, or `production` for mainnet, which spends real NEAR and asks for a typed confirmation first. `scripts/near-mainnet-wizard.sh` walks the whole NEAR mainnet rollout (#39): it funds the mainnet relayer, sets the secret, migrates and deploys production, and checks the result. Every environment requires the key, since each lists a NEAR network. If it is missing or invalid, the facilitator still serves every other chain: NEAR stays in `/supported`, NEAR payments are refused with `invalid_exact_near_no_relayer_configured`, and each request logs `near_relayer_unavailable`.

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
