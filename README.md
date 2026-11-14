<div align="center">
  <img src="assets/wordmark.svg" alt="Herald" height="86">
</div>

---

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

To pay in USDC on NEAR Testnet as well, follow [`examples/weather-api/README.md`](./examples/weather-api/README.md). To run the facilitator and dashboard locally instead of the hosted ones, see [Run locally](./docs/run-locally.md). Cross-chain and NEAR Intents Sweeps need mainnet; they are described under [Dashboard](./docs/dashboard.md).

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

The developer reference (commands, endpoints, secrets and deployment) is in `docs/`:

- [Development](./docs/development.md)
- [Run locally](./docs/run-locally.md)
- [Facilitator](./docs/facilitator.md)
- [Dashboard](./docs/dashboard.md)
- [Admin](./docs/admin.md)
- [Pay the example API](./docs/pay-the-example-api.md)
- [Deploy](./docs/deploy.md)
- [Known workarounds](./docs/known-workarounds.md)
