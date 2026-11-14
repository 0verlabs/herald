# Herald

Herald lets an API that charges per request through [x402](https://x402.org) accept USDC on several chains with the stock x402 libraries. Every payment lands in an ordinary address on the Buyer's chain, and one NEAR account controls all of those addresses through NEAR Chain Signatures. The API's owner moves the money out later from a dashboard, to any address or into NEAR Intents.

Terms used below (Provider, Buyer, Provider Account, Receiving Address, Sweep, Payment Option) are defined in [`GLOSSARY.md`](./GLOSSARY.md). Design decisions are in [`docs/adr/`](./docs/adr/), research in [`docs/research/`](./docs/research/), and the product spec is GitHub issue #1.

## The problem

An API sold over x402 usually accepts USDC on one chain, almost always Base. A Buyer whose USDC is on Solana, Arbitrum or NEAR has to bridge before paying, or goes elsewhere. To accept more chains, the Provider has to run a wallet and key per ecosystem, find a facilitator for each chain, and later collect funds spread across chains by hand. Swapping each payment across chains doesn't fit APIs priced at fractions of a cent: bridges have minimums of $0.15 to $6 and take 20 to 45 s to settle (spec, issue #1; research in [`docs/research/`](./docs/research/)).

## What Herald is

- **For the Provider's server:** `@hrld/x402` ([npm](https://www.npmjs.com/package/@hrld/x402), source in `packages/x402`) exports `accepts({ providerAccount, price })`. It returns one x402 Payment Option per chain, each paying into that Provider Account's Receiving Address on the chain. It derives the addresses offline, without network calls. The Provider keeps the stock `@x402/*` middleware and points the stock `HTTPFacilitatorClient` at Herald's facilitator with a Herald API key.
- **For Buyers:** nothing changes. Any stock x402 client pays on its own chain, for exactly the Price, and needs no gas token. Herald's facilitator settles each payment and pays the gas.
- **For the Provider:** a dashboard, signed in with a NEAR wallet. It shows balances on every chain, the payment log and API keys. It also Sweeps funds out (the dashboard calls this "Withdraw"): to an address on the same chain, to another chain, or into the Provider's NEAR Intents account.

Herald never holds Provider funds or the keys that control them. Herald's own keys pay gas and setup costs only.

Chains: Base, Solana, Arbitrum, Polygon, Avalanche and NEAR on mainnet. NEAR Testnet, Base Sepolia, Solana Devnet and Arbitrum Sepolia on testnet. The token is USDC everywhere.

## How NEAR is used

- **Chain Signatures Receiving Addresses.** Each Receiving Address is derived from the Provider Account's id through NEAR Chain Signatures: the root key of the MPC signer (`v1.signer` on mainnet, `v1.signer-prod.testnet` on testnet), with the Provider Account as the caller and a fixed path. Path `ethereum-1` gives one secp256k1 address used on every EVM chain, `solana-1` an Ed25519 Solana address, and `near-1` an Ed25519 key whose implicit account is the NEAR Receiving Address (`packages/core/src/receiving-addresses.ts`, ADR-0003, ADR-0009). Herald pins the MPC root keys, so `accepts()` works offline, and the facilitator refuses to settle if the pinned keys stop matching the live signer contract. Only the Provider Account can ask the MPC signer to sign for these addresses, so only the Provider can move the money.
- **Sweeps signed by the Provider's NEAR wallet.** To Sweep, Herald builds the transfer (an EIP-3009 `transferWithAuthorization` on EVM, an SPL transfer on Solana) and the Provider's wallet calls `sign` on the MPC signer with its hash. Herald reads the signature from the NEAR transaction over RPC, checks it against the Receiving Address, and submits the transfer, paying the source chain's gas. Withdrawing from **All networks** asks the wallet once for every chain (ADR-0008). With a wallet that can sign delegate actions (e.g. Meteor), the wallet signs each `sign` call as a NEP-366 delegate action and Herald's NEAR relayer sends it and pays the NEAR gas; otherwise the wallet pays (ADR-0010). An unfunded implicit Provider Account is created by Herald on its first sponsored Sweep.
- **NEAR Intents Sweeps.** Cross-chain Sweeps and Sweeps into the Provider's account on `intents.near` go through the NEAR Intents 1Click API: Herald gets a quote and sends the signed transfer to 1Click's deposit address, then follows the swap until it is delivered or refunded (`packages/core/src/server/one-click.ts`, `sweeps.ts`). 1Click has no testnet ([HACKATHON.md](./HACKATHON.md) Q-007), so these Sweeps are mainnet only, and testnet offers same-chain Sweeps.
- **USDC on NEAR as a Payment Option.** A Buyer pays in USDC on NEAR by signing a NEP-366 delegate action that holds one `ft_transfer` into the Provider's NEAR Receiving Address. Herald's relayer submits it and pays the gas, so the Buyer needs no NEAR. Herald creates the implicit account and registers it on the USDC contract at its own cost (ADR-0009).
- **Sign-in.** The dashboard signs Providers in with NEP-413 message signing through `@hot-labs/near-connect`, and accepts only full-access keys of the account.

## Architecture in brief

```text
Buyer (stock @x402/fetch)
  │  GET /weather → 402 listing one Payment Option per chain (from accepts())
  │  retries with a payment signed on its chain
  ▼
Provider API (stock @x402/hono, @hrld/x402)          examples/weather-api
  │  POST /verify, /settle with its Herald API key
  ▼
Herald facilitator (Hono on Cloudflare Workers)      apps/facilitator
  │  one chain queue Durable Object per network holds the gas key and the nonce,
  │  submits the transfer and pays gas, records the payment in D1
  ▼
USDC lands in the Provider's Receiving Address on the Buyer's chain

Provider ── dashboard (TanStack Start on Workers) ── apps/web
  │  Sweep: wallet calls `sign` on the MPC signer for the planned transfer
  │  Herald checks the signature, then submits through the facilitator's chain queue,
  │  directly (same chain) or to a 1Click deposit address (other chain, NEAR Intents)
```

All business logic is in `packages/core`. The two Workers only wire it up and share one D1 database per environment (ADR-0006). Herald runs its own facilitator on the stock `@x402/core` facilitator and `exact` mechanisms (ADR-0004), and Providers use stock x402 config rather than a Herald SDK (ADR-0005).

| Path                   | What it is                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `apps/web`             | Provider dashboard: TanStack Start on Cloudflare Workers, shadcn/ui, Tailwind v4. |
| `apps/facilitator`     | Herald's x402 facilitator: Hono on Cloudflare Workers.                            |
| `packages/core`        | Business logic, and the Zod schemas that define domain types.                     |
| `packages/db`          | Drizzle tables and D1 migrations (Drizzle 1.0 RC, see ADR-0007).                  |
| `packages/x402`        | `@hrld/x402`, the npm package Providers install. Bundles the core code it needs.  |
| `examples/weather-api` | Example Provider API on Workers, and a Buyer script (`scripts/buy.ts`).           |

Hosted deployments:

| Herald environment | Dashboard                           | Facilitator                                     |
| ------------------ | ----------------------------------- | ----------------------------------------------- |
| testnet            | https://herald-testnet.0verlabs.com | https://facilitator.herald-testnet.0verlabs.com |
| mainnet            | https://herald.0verlabs.com         | https://facilitator.herald.0verlabs.com         |

`GET /health` on a facilitator and `GET /api/health` on a dashboard answer `{"status":"ok", …}`. `GET /supported` on a facilitator lists its networks.

## Try it on testnet

These steps use the hosted testnet dashboard and facilitator, and run the example API and the Buyer script on your machine. They use test tokens only. You end with two payments, one from Arbitrum Sepolia and one from Solana Devnet, in the dashboard, and one Sweep on Arbitrum Sepolia.

You need:

- Node.js 22.18 or later, git, and the [Vite+](https://viteplus.dev) CLI: `curl -fsSL https://vite.plus | bash`, then open a new terminal. Vite+ downloads the pnpm version the repo pins.
- A NEAR testnet account in a browser wallet. These steps were tested with [Meteor Wallet](https://meteorwallet.app). Meteor signs delegate actions, so Herald pays the Sweep's NEAR gas, and an unfunded implicit account is created by Herald on its first sponsored Sweep. With a wallet that can't sign delegate actions, the wallet pays, so the account needs a little testnet NEAR ([near-faucet.io](https://near-faucet.io)).
- Testnet USDC from the [Circle faucet](https://faucet.circle.com), on Arbitrum Sepolia and on Solana Devnet. The Buyer needs no ETH or SOL.

**1. Sign in to the dashboard.** Open https://herald-testnet.0verlabs.com, click **Connect NEAR wallet**, pick your wallet and sign the message. Signing sends no transaction.
You see **Home**: **Total balance**, **Money in**, and **Payment addresses**, which lists your NEAR, EVM and Solana Receiving Addresses. The first sign-in registers you. Herald then creates your Solana USDC token account and your NEAR Receiving Address, and those rows show **Setting up USDC** until that's done. Reload the page until the Solana row no longer shows it.

**2. Create an API key.** Open **API keys** in the sidebar and click **Create key**.
You see **Your new API key** with an `hk_test_…` key. Herald shows it once, so copy it now.

**3. Run the example API.**

```bash
git clone https://github.com/0verlabs/herald.git
cd herald
vp install
cp examples/weather-api/.dev.vars.example examples/weather-api/.dev.vars
```

In `examples/weather-api/.dev.vars`, set `HERALD_API_KEY` to your key. In `examples/weather-api/wrangler.jsonc`, set `PROVIDER_ACCOUNT` to the NEAR testnet account you signed in with. Leave `HERALD_FACILITATOR_URL` empty: the API then uses Herald's hosted testnet facilitator. Then start the API:

```bash
vp -C examples/weather-api run dev   # http://localhost:8788
```

In a second terminal, from the repo root, ask for the paid resource without paying:

```bash
curl -s -o /dev/null -D - http://localhost:8788/weather \
  | awk 'tolower($1) == "payment-required:" { print $2 }' | tr -d '\r' | base64 --decode
```

You see the x402 `PAYMENT-REQUIRED` header decoded: JSON whose `accepts` holds four Payment Options of `1000` (0.001 USDC), for `near:testnet`, `eip155:84532` (Base Sepolia), `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Solana Devnet) and `eip155:421614` (Arbitrum Sepolia). Each `payTo` is one of the addresses on your dashboard's Home.

**4. Pay from Arbitrum Sepolia.** Use a throwaway EVM key holding Arbitrum Sepolia USDC. To make one, run this from the repo root, then send USDC from the Circle faucet to the address it prints:

```bash
(cd examples/weather-api && node --input-type=module -e "import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'; const key = generatePrivateKey(); console.log('BUYER_PRIVATE_KEY=' + key, privateKeyToAddress(key))")
```

Then pay:

```bash
export BUYER_PRIVATE_KEY=0x…   # the throwaway key
vp -C examples/weather-api run buy --network eip155:421614
```

You see `HTTP 200: {"city":"Jakarta","temperatureC":31,"conditions":"Humid"}`, then `Settlement:` with `success: true`, the Buyer's address as `payer`, the transaction hash and `network: 'eip155:421614'`.

**5. Pay from Solana Devnet.** Use a throwaway Solana key holding Devnet USDC, as a base58 64-byte secret key (Phantom exports this format). To make one, run this from the repo root, then send USDC from the Circle faucet to the address it prints:

```bash
(cd examples/weather-api && node --input-type=module -e "import { generateKeyPairSync } from 'node:crypto'; import { createKeyPairSignerFromBytes, getBase58Decoder } from '@solana/kit'; const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }); const bytes = Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')]); const signer = await createKeyPairSignerFromBytes(bytes); console.log('BUYER_SOLANA_KEY=' + getBase58Decoder().decode(bytes), signer.address)")
```

Then pay:

```bash
export BUYER_SOLANA_KEY=…   # the throwaway key
vp -C examples/weather-api run buy --network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
```

You see `HTTP 200` with the weather, then `Settlement:` with `success: true` and `network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'`.

**6. See both payments in the dashboard.** Open **Payments**.
You see both payments under **All payments**, newest first: 0.001 USDC each, the network (Solana Devnet, Arbitrum Sepolia), the Buyer under **Paid by**, `http://localhost:8788/weather` under **For**, and a **Receipt** link to the transaction on the chain's block explorer. **Home** now counts them under **Money in**, and **Total balance** includes them.

**7. Sweep on Arbitrum Sepolia.** Open **Withdraw**. Under **New withdrawal**, pick **USDC** as **Coin** and **Arbitrum Sepolia** as **From network**. Under **Send to**, pick **Arbitrum Sepolia**, enter any EVM address you control (the Buyer's from step 4 works), enter `0.001` as **Amount**, and click **Approve withdrawal in wallet**. Your wallet asks you to approve one call to `sign` on `v1.signer-prod.testnet`, attaching 1 yoctoNEAR. With Meteor, Herald pays its NEAR gas; for an unfunded implicit account, the button first shows "Herald is preparing your NEAR account…" while Herald creates it. A wallet that can't sign delegate actions sends it as its own transaction and pays the gas.
You see the withdrawal in **Withdrawal history** go from **Approving** to **Sending** to **Sent** as the page refreshes. **Receipts** links the NEAR transaction that carries the MPC signature and the Arbitrum Sepolia transfer, which Herald's gas wallet submitted. The destination received the full 0.001 USDC.

If a step fails:

| What you see                                                          | Cause and fix                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Solana payment refused with `invalid_exact_svm_recipient_ata_missing` | Herald hasn't created your Solana USDC token account yet. Wait until Home no longer shows **Setting up USDC** for Solana.       |
| `insufficient_funds`                                                  | The Buyer holds less than 0.001 USDC on that network.                                                                           |
| Every payment refused, the facilitator answering 403                  | `PROVIDER_ACCOUNT` isn't the account the API key belongs to, so `payTo` isn't that Provider's. Set it to the signed-in account. |
| A dev server doesn't start while another runs                         | Give it another `--inspector-port`.                                                                                             |

To pay in USDC on NEAR Testnet as well, follow [`examples/weather-api/README.md`](./examples/weather-api/README.md). To run the facilitator and dashboard locally instead of the hosted ones, see [Run locally](#run-locally). Cross-chain and NEAR Intents Sweeps need mainnet; they are described under [Dashboard](#dashboard).

## Hackathon notes

Herald was built for [NEAR HACKATHON](https://nearhackathon.com) (2026-11-01 to 2026-11-14, with code allowed from the 2026-10-19 announcement).

**What existed before the hackathon.** Nothing in this repository. The first three commits are all from 2026-11-09 (UTC): `f9083ea` added the third-party agent skills in `.agents/`, `.claude/` and `.kiro/`, `AGENTS.md`, the organizers' `HACKATHON.md` and the issue-tracker notes in `docs/agents/`; `0ead000` added the research, ADRs and glossary; `3789ebb` added the monorepo scaffold, and all product code came after it. Herald uses no pre-hackathon code or libraries of its own. Every dependency is a third-party package listed below, or one of the workspace packages in this repo (`@herald/*`, `@hrld/x402`).

**How it was built.** Most code, docs and research were written with AI coding agents, working from the GitHub issues in this repo (the spec is #1). The agent skills they used are third-party. Their sources are in `skills-lock.json`: `mattpocock/skills`, `cloudflare/skills`, `near/agent-skills`, `honojs/skills`, `TanStack/router`, `shadcn/ui`, `shadcn/improve`, `Leonxlnx/taste-skill` and `benjitaylor/skills`.

**Templates and generated code.** The files in `apps/web/src/components/ui` come from [shadcn/ui](https://ui.shadcn.com) through its CLI (`apps/web/components.json`), on Base UI. Generated files: `apps/web/src/routeTree.gen.ts` (TanStack Router), `worker-configuration.d.ts` per Worker (`wrangler types`), and `packages/db/migrations` (drizzle-kit). The network and USDC logos in `apps/web/public/logos` are those projects' own marks. No starter repository was used.

**Libraries.** Versions are pinned in the `catalog` of `pnpm-workspace.yaml`.

| Area            | Libraries                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| x402            | `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/near`, `@x402/hono`, `@x402/fetch`                                                                                                            |
| NEAR            | `@hot-labs/near-connect` (dashboard wallets), `near-api-js` (tests and scripts). Herald encodes NEAR transactions and delegate actions itself (`packages/core/src/server/near-protocol.ts`). |
| EVM and Solana  | `viem`, `@solana/kit`, `@solana-program/token`                                                                                                                                               |
| Cryptography    | `@noble/curves`, `@noble/hashes`, `@scure/base`                                                                                                                                              |
| Server and data | Hono, Zod 4, Drizzle ORM and drizzle-kit 1.0 RC                                                                                                                                              |
| Dashboard       | TanStack Start and Router, React, shadcn/ui, Base UI (`@base-ui/react`), Tailwind CSS v4, `tw-animate-css`, `class-variance-authority`, lucide-react, Shiki, Fontsource fonts                |
| Platform        | Cloudflare Workers, Durable Objects, D1, KV, Rate Limiting and Cron Triggers; Wrangler, `@cloudflare/vite-plugin`, `@cloudflare/vitest-plugin`                                               |
| Toolchain       | Vite+ (Vite, Vitest, Oxlint, Oxfmt, `vp pack`), TypeScript 7                                                                                                                                 |

**External services.** NEAR Chain Signatures (`v1.signer`, `v1.signer-prod.testnet`), the NEAR Intents 1Click API, QuickNode RPC endpoints for every chain, the public FastNEAR testnet RPC (the Buyer script's default for NEAR), and the Circle USDC faucet for testnet.

## License

[MIT](./LICENSE).

## Reference

The rest of this README is the developer reference: commands, endpoints, secrets and deployment.

### Development

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

NEAR payments (NEAR on mainnet and NEAR Testnet, listed first in each environment; ADR-0009) settle with the stock `@x402/near` `exact` mechanism. The Buyer signs a NEP-366 delegate action holding one USDC `ft_transfer` into the Provider's NEAR Receiving Address (an implicit account derived on `near-1`, ADR-0009), and needs no NEAR. One `NearChainQueue` Durable Object per network holds the relayer key, wraps the delegate action in a relayer transaction with the next relayer nonce, sends it and waits until it is final (up to `SETTLE_RECEIPT_TIMEOUT_MS`), outside the nonce lock. It remembers every signed delegate action it was given, so presenting one again, from any isolate, is refused instead of relayed. The payment is recorded with the Buyer's NEAR account and the relayer transaction's hash. A Receiving Address must exist and be registered on USDC (`storage_deposit`) before payments into it pass `/verify`; until then they answer `invalid_exact_near_recipient_not_registered_for_storage`. Herald sets it up at its own cost: every sign-in of a Provider whose NEAR Receiving Address isn't set up yet (`near_setup_status` not `created`) queues a setup job on `NearChainQueue`, whose alarm sends two relayer transactions, each only if the chain doesn't show it done: a 0.002 NEAR transfer that creates the implicit account, and `storage_deposit` on USDC (0.00125 NEAR, `registration_only`). The facilitator's Cron Trigger (every 10 minutes, `triggers.crons` in its `wrangler.jsonc`) queues the setup of up to 50 Providers per run that are `not_queued`, so Providers registered before NEAR are set up without signing in again. A failed attempt is retried after 30 s, 1, 2, 5 and 10 min; after six the Provider goes back to `not_queued`, and the next scheduled run or sign-in queues it again. The facilitator never sets an account up while verifying or settling a payment. Home shows the status next to the NEAR address.

Facilitator secrets per environment:

| Secret                                               | What it is                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EVM_GAS_KEY`                                        | 0x hex private key, one gas wallet for every EVM chain.                                                                       |
| `SOLANA_GAS_KEY`                                     | base58 64-byte secret key, funded with SOL for fees and token account rent.                                                   |
| `BASE_RPC_URL`, `SOLANA_RPC_URL`, `ARBITRUM_RPC_URL` | JSON-RPC endpoint of each chain, for the environment's network (Base Sepolia, Solana Devnet and Arbitrum Sepolia on testnet). |
| `POLYGON_RPC_URL`, `AVALANCHE_RPC_URL`               | Mainnet only.                                                                                                                 |
| `NEAR_RPC_URL`                                       | NEAR testnet or mainnet, for the MPC root-key check and NEAR settlements.                                                     |
| `NEAR_RELAYER_KEY`                                   | `ed25519:` and a base58 64-byte secret key: the NEAR relayer, an implicit account. `scripts/near-relayer-wizard.sh` makes it. |

Every RPC endpoint is a private QuickNode URL, which carries the API key, so all of them are secrets. Solana's public endpoints wouldn't work anyway: `api.devnet.solana.com` and `api.mainnet-beta.solana.com` refuse requests from Workers (they block on the `CF-Worker` header, locally too). The web Worker needs `NEAR_RPC_URL` for sign-in and for reading Sweep signatures, and the same `<CHAIN>_RPC_URL` secrets as the facilitator for Home's live balances and for following Sweeps (EVM receipts; Solana blockhashes, accounts and signature statuses).

To get a Provider and an API key without the dashboard:

```bash
vp -C apps/facilitator run seed alice.testnet                # local D1
vp -C apps/facilitator run seed alice.testnet --env testnet  # herald-testnet D1
```

It prints the Provider's Receiving Addresses and an `hk_test_` key, once. Locally it also queues the Provider's Solana USDC token account, so run the facilitator first. On testnet the token account is queued at the Provider's first dashboard sign-in.

### Dashboard

`apps/web` is the Provider dashboard. Open it (`vp -C apps/web dev`, then http://localhost:3000), click **Connect NEAR wallet**, pick a wallet and sign the message it shows. Use a `.testnet` account on the testnet deployment and locally. Signing sends no transaction. You land on **Home**, whose **Payment addresses** card shows your NEAR Receiving Address, your EVM Receiving Address (one address for every EVM chain Herald lists) and your Solana Receiving Address, each with a copy button. Signed-out visitors to a dashboard page are sent to sign-in.

**Total balance** on Home shows the live USDC balance of your Receiving Addresses on each chain, read from that chain's RPC (`<CHAIN>_RPC_URL`) after the page loads. A chain whose RPC fails or takes over 8 s shows as unavailable without hiding the others. **Money in** totals the payments Herald settled for you, over the last 7 days and all time. **Payments** lists every settled payment, newest first, 25 per page: date, amount, network, Buyer address (**Paid by**), resource URL (**For**) and the transaction (**Receipt**), linked to the chain's block explorer. The queries live in `packages/core/src/server` (`payments.ts`, `balances.ts`); `apps/web/src/server/overview.ts` and `payments.ts` wire them to server functions.

**API keys** lists your keys with their prefix, mode, creation time, last use and status. **Create key** issues an `hk_test_` key on testnet (`hk_live_` on mainnet) and shows it once; Herald keeps only its SHA-256 hash. **Revoke** stops a key at once: the facilitator answers its next request with 401 `revoked_api_key`. **Connect your API** shows a Node.js server for Hono and for Express, ready to paste: the stock `HTTPFacilitatorClient` pointed at Herald's facilitator with the key from `HERALD_API_KEY`, a server scheme for `near:*`, `eip155:*` and `solana:*`, and `accepts()` filled in with your Provider Account. A server that doesn't want NEAR passes `networks` to `accepts()` without it and drops the `near:*` scheme. Below it, a Node.js Buyer with the stock `@x402/fetch` client registers each chain family only when its key is set, and says to set the NEAR key only with USDC on NEAR, since NEAR is listed first.

Sign-in uses NEP-413 through `@hot-labs/near-connect`:

1. The server issues a single-use nonce, valid for 5 minutes, kept in D1 (`sign_in_nonces`).
2. The wallet signs Herald's message, the nonce and the dashboard's host as recipient.
3. The server checks the ed25519 signature and asks NEAR RPC (`NEAR_RPC_URL`) whether the key is a full-access key of the account. Function-call keys are refused. An implicit account that isn't on NEAR yet is accepted when its id is the presented key.
4. The first sign-in registers the Provider, stores its Receiving Addresses, queues its Solana USDC token account with the facilitator's `SolanaChainQueue` and its NEAR Receiving Address setup with the facilitator's `NearChainQueue` (the `SOLANA_CHAIN_QUEUE` and `NEAR_CHAIN_QUEUE` bindings, `script_name` the facilitator Worker). If a queue can't be reached, sign-in still succeeds and the next sign-in tries again; for NEAR, the facilitator's scheduled run does too. Home shows the status of both. Locally, run the facilitator alongside the dashboard. A session goes into the `SESSIONS` KV namespace for 7 days, keyed by the SHA-256 of a random token held in an HTTP-only cookie. Signing out deletes it.

`SIGN_IN_RATE_LIMITER` allows 20 sign-in requests per minute per client IP. The logic lives in `packages/core/src/server` (`sign-in.ts`, `sessions.ts`); `apps/web/src/server/auth.ts` wires it to TanStack Start server functions.

**Withdraw** makes Sweeps; the dashboard calls them withdrawals. A same-chain Sweep moves USDC from a Receiving Address to any address on the same chain: the EVM one on Base or Arbitrum (plus Polygon and Avalanche on mainnet), the Solana one on Solana. Pick the **Coin** and the **From network**, pick the same network under **Send to**, enter the wallet address and an **Amount**, and the page shows what will happen: the destination receives the full amount, with no fee. The button stays disabled below the chain's minimum, above your balance, or once 10 Sweeps went out in the last 24 hours. **All networks** under **From network** withdraws every balance with one wallet request (ADR-0008). **Approve withdrawal in wallet** then:

1. Plans the Sweep (`planSweep` in `packages/core/src/server/sweeps.ts`): it checks the destination, the minimum in the `sweep_minimums` table, the daily cap and the balance, then builds the payload.
   - EVM: the EIP-712 hash of an EIP-3009 `transferWithAuthorization` from the Receiving Address to the destination, valid for 10 minutes.
   - Solana: an SPL `TransferChecked` from the Receiving Address's USDC token account to the destination's, with Herald's Solana gas wallet as fee payer (`packages/core/src/server/solana-sweeps.ts`). If the destination has no USDC token account, the transaction creates it first, with Herald paying the rent. The destination must be a wallet, not a token account. The transaction uses a recent blockhash, so it must be signed within about a minute.
2. Asks your wallet to call `sign` on the MPC signer (`v1.signer-prod.testnet` on testnet, `v1.signer` on mainnet) with the payload as `payload_v2`, 1 yoctoNEAR and 50 Tgas: `{ Ecdsa: <hash> }` with path `ethereum-1` and domain 0 on EVM, `{ Eddsa: <transaction message> }` with path `solana-1` and domain 1 on Solana. The wallet must hold the Provider Account you signed in with. With a wallet that can sign delegate actions (e.g. Meteor), the wallet signs the call as a delegate action and Herald's NEAR relayer sends it and pays the NEAR gas; otherwise the wallet sends it and pays. An unfunded implicit Provider Account is created by Herald on its first sponsored Sweep (`prepareSponsoredSweepAccount`).
3. Sends the NEAR transaction hash to the server (`completeSweep`), or the signed delegate action, which Herald relays (`relaySponsoredSweep`). Herald reads the signature from the NEAR transaction over `NEAR_RPC_URL`, never from the browser, and checks it against your Receiving Address for the planned payload: ECDSA recovery on EVM, Ed25519 verification of the message on Solana. A signature that doesn't match fails the Sweep.
4. Submits the signed transfer through the facilitator's chain queue for the chain (`submitSweep` over the `EVM_CHAIN_QUEUE` or `SOLANA_CHAIN_QUEUE` cross-Worker binding), which pays the gas. The `SolanaChainQueue` adds the fee payer's signature only to a transaction that is a Sweep and uses the gas wallet for nothing but the fee and that token account rent, and has the node simulate it before sending. Submitting the same Sweep again answers the same transaction hash or signature without sending anything.

**Withdrawal history** follows each Sweep through `planned → awaiting_signature → submitted → confirmed | failed` (shown as Not approved, Approving, Sending, Sent, Failed), with links to the NEAR and chain transactions. While one is unfinished the page refreshes every 3 s: it reads the signature if it wasn't on NEAR yet, then whether the transfer landed over `<CHAIN>_RPC_URL` (the receipt on EVM, the signature status on Solana). An EVM Sweep never signed within its 10 minutes fails, as does one whose transfer reverted or the chain queue refused. A Solana Sweep fails if it isn't signed in time, if the transaction failed or the queue refused it, or if it hasn't landed once Solana is past the blockhash's last valid block height. Minimums are seeded from `docs/research/stack-and-minimums.md`: 0.15 USDC on Base (1Click's minimum there), 0.001 USDC elsewhere; testnet networks mirror their mainnet counterparts.

**Cross-chain and NEAR Intents Sweeps** (mainnet only: 1Click has no testnet, so on testnet the page offers same-chain Sweeps only). Under **Send to**, pick another network to receive USDC at an address there, or **NEAR Intents** to have USDC credited to your Provider Account inside `intents.near`, as the source chain's USDC token. **Get a quote** plans the Sweep with a live 1Click quote (`requestQuote` in `packages/core/src/server/sweeps.ts`, client in `one-click.ts`):

- The quote is `EXACT_INPUT` from the source chain's USDC, with `recipientType: DESTINATION_CHAIN` (your address) or `INTENTS` (your Provider Account), and `refundTo` set to the source Receiving Address. Herald asks for a 30-minute deadline.
- The page shows what you will receive (and the least, after 0.5% slippage), 1Click's fee, the minimum, the time estimate, the refund fee and a countdown to sign. The transfer must be signed 10 minutes before 1Click's deadline at the latest, so it lands before the deposit address goes inactive: within 10 minutes on EVM, about a minute on Solana. Once the countdown runs out, **Get a new quote** plans a new Sweep, and the old one fails as unsigned.
- An amount below 1Click's minimum for the route is refused with the minimum 1Click names. So is a route where 1Click would keep more than 10% of the Sweep if it refunded (`MAX_REFUND_FEE_PERCENT`): from Solana 1Click keeps about 0.22 USDC, so Sweeps from Solana through 1Click start at about 2.21 USDC. The message names the least amount.
- **Approve withdrawal in wallet** signs and submits the transfer as for a same-chain Sweep, but to 1Click's deposit address. A quote you discard, replace or let expire is never listed: the history shows a 1Click Sweep only once your wallet sent its signing transaction, and a discarded quote can't be signed later.

After the transfer confirms, the page follows `GET /v0/status` on 1Click for the deposit address: `confirmed → delivering → delivered | refunded` (On its way, Arrived, Refunded), or `failed` if 1Click gives up. If 1Click still hasn't seen the deposit an hour after the quote's deadline (`ONE_CLICK_PICKUP_GRACE_SECONDS`), the Sweep fails with the deposit address to give NEAR Intents support. A swap 1Click is already delivering keeps being followed. The history links the swap on the NEAR Intents explorer and, for a cross-chain Sweep, the delivery transaction. 1Click quotes without a key. An optional partner key lowers its fee on some routes: set it with `CLOUDFLARE_ENV=production wrangler secret put ONE_CLICK_JWT` in `apps/web`. It is deliberately left out of `secrets.required`, because `wrangler deploy` refuses to deploy without a required secret.

### Admin

`/admin` is for Herald admins: the NEAR account ids in the web Worker's `HERALD_ADMINS` var, comma-separated (`"ops.near, alice.near"`), set per environment in `apps/web/wrangler.jsonc` and locally in `.dev.vars`. It ships empty, so nobody is an admin until you set it. Everyone else, signed in or not, gets a 404, from the page and from its server functions. Admins see an **Admin** link in the sidebar.

**Fee wallets** lists Herald's gas wallet on each chain of the environment: the address the facilitator's chain queue holds the key for, and its native balance (ETH, SOL, POL, AVAX) read from `<CHAIN>_RPC_URL`. A wallet below its threshold in `GAS_LOW_BALANCE_THRESHOLDS` (whole tokens per CAIP-2 network) is flagged **Low**; a network without a threshold never warns. **Smallest withdrawals** lists the `sweep_minimums` rows of the environment. **Edit** changes a row's minimum (in USDC) and note, checked with `SweepMinimumEditSchema` in the browser and on the server, and stamps it updated; the next Sweep planned uses it. The logic lives in `packages/core/src/server` (`admin.ts`, `balances.ts`); `apps/web/src/server/admin.ts` wires it.

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

The NEAR relayer's key (`NEAR_RELAYER_KEY` on the facilitator) comes from a wizard that creates the relayer, funds it and sets the secret: `scripts/near-relayer-wizard.sh testnet`, or `production` for mainnet, which spends real NEAR and asks for a typed confirmation first. `scripts/near-mainnet-wizard.sh` walks the whole NEAR mainnet rollout (#39): it funds the mainnet relayer, sets the secret, migrates and deploys production, and checks the result. `scripts/mainnet-rollout-wizard.sh` walks the mainnet rollout and its real-money checks (#14): it checks production's D1, KV and secrets, migrates and deploys, tops up the gas wallets, runs the live checks, then makes one $0.001 payment on Base and one Sweep of under $1 into the Provider's NEAR Intents account, each after a typed approval, and posts the tx hashes and fees on #14. Every environment requires the key, since each lists a NEAR network. If it is missing or invalid, the facilitator still serves every other chain: NEAR stays in `/supported`, NEAR payments are refused with `invalid_exact_near_no_relayer_configured`, and each request logs `near_relayer_unavailable`.

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
