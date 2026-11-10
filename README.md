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
vp test                 # run every test (Workers tests run in the Cloudflare Vitest pool)
vp run ready            # check, test and build everything
```

### Run locally

```bash
vp run db:migrate:local         # apply D1 migrations to the local database
vp -C apps/facilitator run dev  # facilitator on http://localhost:8787 (GET /health)
vp -C apps/web dev              # dashboard on http://localhost:3000 (GET /api/health)
```

`vp run dev` starts every app at once. Both Workers keep local D1 and KV state in `.wrangler/state` at the repo root, so they share one local database, as they share one database per environment when deployed.

After changing a `wrangler.jsonc`, run `vp run -r types` to regenerate binding types (`wrangler types --env-interface CloudflareBindings`). Hono apps type their bindings as `new Hono<{ Bindings: CloudflareBindings }>()`; `env` from `cloudflare:workers` is typed through `Cloudflare.Env`, which Wrangler declares with the same bindings. After changing `packages/db/src/schema.ts`, run `vp run db:generate` to write a new migration.

### Deploy

Each Worker has two Wrangler environments, `testnet` and `mainnet`, each with its own Worker name, D1 database and KV namespace:

| Environment | Facilitator                  | Web                  | D1               | KV (`SESSIONS`)           |
| ----------- | ---------------------------- | -------------------- | ---------------- | ------------------------- |
| `testnet`   | `herald-facilitator-testnet` | `herald-web-testnet` | `herald-testnet` | `herald-sessions-testnet` |
| `mainnet`   | `herald-facilitator-mainnet` | `herald-web-mainnet` | `herald-mainnet` | `herald-sessions-mainnet` |

Sign in once with `npx wrangler login`.

First deploy only: create the resources and put their IDs in both `apps/facilitator/wrangler.jsonc` and `apps/web/wrangler.jsonc` (IDs are not secrets). Until then those files hold all-zero placeholder IDs.

```bash
cd apps/facilitator
vp exec wrangler d1 create herald-testnet                   # -> database_id for env.testnet (both Workers)
vp exec wrangler kv namespace create herald-sessions-testnet  # -> SESSIONS id for env.testnet (apps/web)
```

Then, for each deploy:

```bash
vp -C apps/facilitator run db:migrate:testnet   # apply migrations to the testnet D1 database
vp run deploy:testnet                           # deploy the facilitator, then the web app
```

Use the `mainnet` variants the same way. The facilitator deploys first because the web app will bind to its Durable Objects (ADR-0006). The web app picks its environment at build time through `CLOUDFLARE_ENV`, so its deploy scripts build first and then run `wrangler deploy` without `--env`.

Secrets (gas wallet keys, the 1Click JWT) never go in the repo. Set them per environment with `npx wrangler secret put <NAME> --env <testnet|mainnet>` from the Worker's directory, and keep local values in a gitignored `.dev.vars`.

### Known workarounds

| Where                                      | Workaround                                                                                                         | Why                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                      | `vite` overridden to the Vite+ core alias, and `peerDependencyRules` allow any `vite` version.                     | [Vite+ #2806](https://github.com/voidzero-dev/vite-plus/issues/2806): the alias reports version 1.5.x, so plugins that peer on `vite@^8` fail the check. |
| `vite.config.ts` (root, `test.projects`)   | `apps/web` is not a test project.                                                                                  | [workers-sdk #15969](https://github.com/cloudflare/workers-sdk/issues/15969): Vitest fails to start when the config loads `@cloudflare/vite-plugin`.     |
| `apps/facilitator`, `examples/weather-api` | Run and deploy with Wrangler directly, not through Vite. The facilitator's `vite.config.ts` only configures tests. | Keeps `@cloudflare/vite-plugin` out of every Vitest config (same issue).                                                                                 |
| `packages/*`, `apps/facilitator`           | Workers tests use `@cloudflare/vitest-plugin`, not `@cloudflare/vitest-pool-workers`.                              | The pool-workers package only supports Vitest 4; Vite+ ships Vitest 5. The renamed plugin supports both.                                                 |
| `packages/tsconfig.x402-dts.json`          | The `@hrld/x402` declaration build uses a tsconfig in `packages/`, not in `packages/x402`.                         | tsgo writes declarations for files outside `--rootDir` next to their sources, which would litter `packages/core/src`.                                    |

[Vite+ #1671](https://github.com/voidzero-dev/vite-plus/issues/1671) (React duplicated in SSR) and [#2481](https://github.com/voidzero-dev/vite-plus/issues/2481) (dev server wedges after a restart) did not show up while setting up `apps/web` on vite-plus 1.5.1. If the dashboard dev server stops answering after a config change, restart `vp dev`.
