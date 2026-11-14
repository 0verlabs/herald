# Deploy

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
