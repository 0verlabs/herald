# Stack facts and deposit-minimum seed data

Status: research note, facts only (no decisions). Gathered 2026-11-09, 20:45-21:30 UTC. Every network call was read-only: npm registry reads, docs fetches, GitHub reads, JSON-RPC/REST reads, and NEAR `view` calls. Nothing was signed or sent.

Builds on [near-intents.md](./near-intents.md) and [static-deposit-address.md](./static-deposit-address.md).

Versions are from `npm view <pkg> version` at 2026-11-09 ~21:00 UTC unless noted.

---

# Part A: stack facts

## A1. Vite+ (`vite-plus`, CLI `vp`)

**Status and version**

- `vite-plus` latest is **1.5.1** (published 2026-11-09). 1.0.0 was published 2026-09-28, 0.1.0 on 2026-03-06 (npm `time`).
- The 1.0 announcement calls it stable and MIT licensed, with roughly two million weekly downloads ([Announcing Vite+ 1.0](https://voidzero.dev/posts/announcing-vite-plus-1-0)). The 1.0 post lists remote caching, deeper monorepo diagnostics, `vp release` and `vp docs` as still planned.

**License**

- MIT (npm `license` field, and the [README](https://github.com/voidzero-dev/vite-plus/blob/main/README.md)).
- The original announcement described a commercial licensing model. An editor's note on that post says the model was dropped before public release ([Announcing Vite+](https://voidzero.dev/posts/announcing-vite-plus)).
- VoidZero has joined Cloudflare. The post says Vite, Vitest, Rolldown, Oxc and Vite+ stay open source and MIT ([VoidZero is joining Cloudflare](https://voidzero.dev/posts/voidzero-cloudflare)).

**What it bundles** (from `npm view vite-plus@1.5.1 dependencies bin`, plus the 1.0 post's command table)

| Command | Tool underneath | Version pinned by vite-plus 1.5.1 | Standalone latest |
| --- | --- | --- | --- |
| `vp dev` / `vp build` / `vp preview` | Vite 8 + Rolldown, shipped as `@voidzero-dev/vite-plus-core` (installed as `vite` via an alias) | `vite: npm:@voidzero-dev/vite-plus-core@1.5.1` | vite 8.3.7, rolldown 1.3.1 |
| `vp test` | Vitest | 5.1.0 | 5.1.0 |
| `vp check` / `vp lint` / `vp fmt` | Oxlint (+ `oxlint-tsgolint` for type-aware rules), Oxfmt | oxlint =1.91.0, oxfmt =0.76.0, oxlint-tsgolint =7.0.2005 | oxlint 1.93.0, oxfmt 0.78.0 |
| `vp pack` | tsdown | via core | tsdown 0.23.7 |
| `vp run` (alias `vpr`) | Vite Task: monorepo-aware runner with caching | built in | – |
| `vp install/add/remove/...`, `vp pm ...` | Your package manager (pnpm, npm, yarn, bun) | – | – |
| `vp env` | Node.js version management | – | – |
| `vp hooks`, `vp staged` | Git hooks, checks on staged files | – | – |
| `vpx`, `vp dlx` | Run package binaries | – | – |

Sources: [1.0 post](https://voidzero.dev/posts/announcing-vite-plus-1-0), [docs index](https://viteplus.dev/llms.txt).

**Scaffolding and monorepo setup**

- The docs have no `vp new` command. Scaffolding is `vp create`, with built-in templates `vite:monorepo`, `vite:application`, `vite:library` and `vite:generator` (generator is monorepo-only). It also accepts shorthand community templates, **including `@tanstack/start`**, plus full `create-*` package names and GitHub templates. `--package-manager pnpm`, `--no-interactive`, `--directory` and `--hooks` are available ([Creating a Project](https://viteplus.dev/guide/create.md)). Without a global install: `pnpm create vite-plus`.
- Monorepo config ([Monorepo guide](https://viteplus.dev/guide/monorepo.md)):
  - One root `vite.config.ts` (`defineConfig` from `vite-plus`) holds shared `lint`, `fmt`, `staged` and `run.tasks` settings. Per-package differences go in `lint.overrides` / `fmt.overrides` with workspace globs such as `apps/web/**`. The docs advise against package-level `lint`/`fmt` blocks.
  - Packages can still have their own `vite.config.ts` for Vite, Vitest, framework or runtime settings.
  - `vp dev` / `vp build` at the root never act on the root itself. Vite+ picks the one app-like package or shows a picker; in CI it exits 1 with a list. Use `vp -C apps/web dev`, or set `defaultPackage` in the root config.
- Workspaces come from the package manager (for pnpm, `pnpm-workspace.yaml`). The task graph comes from normal `package.json` `dependencies` between workspace packages ([Run guide](https://viteplus.dev/guide/run.md)).
  - `vp run -r build` runs in dependency order. `-t` runs a package plus its dependencies. `--filter` uses pnpm syntax. `@my/app#build` targets one package's task. `dependsOn: [{ task: 'build', from: 'dependencies' }]` is supported.
  - Tasks defined in `vite.config.ts` are cached by default. `package.json` scripts are cached only with `--cache`. Default concurrency is 4.
- Packaging detail: the required `vite` alias exposes the wrapper package's own version (for example `1.0.0-rc.0`), not the bundled Vite version. Under pnpm strict peer validation this produces peer-range mismatches for Vite plugins. Open issue [#2806](https://github.com/voidzero-dev/vite-plus/issues/2806): a maintainer said on 2026-10-06 that they plan to version the core package on Vite's major. A 2026-11-09 comment notes pnpm now marks `peerDependencyRules` (the current workaround) as deprecated. Related: [#2356](https://github.com/voidzero-dev/vite-plus/issues/2356), where dependency bots update `vite-plus` and the `vite` catalog alias out of step.

**TanStack Start and `@cloudflare/vite-plugin` compatibility** (GitHub issues, read 2026-11-09)

| Issue | State | What it says |
| --- | --- | --- |
| [#1391](https://github.com/voidzero-dev/vite-plus/issues/1391) | closed 2026-09-07 | TanStack Start SSR broke because two copies of vite-plus-core failed an `instanceof` check |
| [#1671](https://github.com/voidzero-dev/vite-plus/issues/1671) | **open** (last activity 2026-06-03, waiting on a repro) | React module duplication in workerd SSR (`HeadContent` `useContext`) with TanStack Start + `@cloudflare/vite-plugin`, reported on vite-plus 0.1.22 |
| [#2481](https://github.com/voidzero-dev/vite-plus/issues/2481) | **open** (2026-08-17) | Dev server restart can wedge permanently under `@cloudflare/vite-plugin` when a request straddles the restart |
| [#3369](https://github.com/voidzero-dev/vite-plus/issues/3369) | closed 2026-11-06 | `vp test` failed at startup with `@cloudflare/vite-plugin` on vite-plus 0.3.1 (double-prefixed `node:` externals). Reporter confirmed it fixed on 1.4.0 and 1.5.0. `vp build` and `wrangler deploy` were never affected |
| [#1076](https://github.com/voidzero-dev/vite-plus/issues/1076) | closed 2026-09-16 | `vp test` vs `@cloudflare/vitest-pool-workers` |

A community template, [tsu-moe/tsu-stack](https://github.com/tsu-moe/tsu-stack), is a Vite+ TanStack Start monorepo. Its README says it runs on workerd "with a few tweaks".

## A2. TanStack Start on Cloudflare Workers

**Versions**

- `@tanstack/react-start` **1.169.5** (2026-11-08), `@tanstack/react-router` 1.170.46.
- Start 1.0 was declared stable on 2026-10-13 ([TanStack blog](https://tanstack.com/blog/tanstack-start-1-0)). The RC migration guide says 1.169 is the first stable release ([migrate from RC](https://tanstack.com/start/latest/docs/framework/react/migrate-from-release-candidate)).
- Cloudflare tooling: `@cloudflare/vite-plugin` 1.68.0 (2026-11-09) and `wrangler` 4.159.0 (2026-11-09).

**Official deployment path** ([Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/), last updated 2026-11-05)

- **New app:** `pnpm create cloudflare@latest my-app --framework=tanstack-start`.
- **Existing app without a Wrangler config:** `wrangler deploy` detects TanStack Start and generates the config itself.
- **Manual setup:**
  1. Install `@cloudflare/vite-plugin` and `wrangler`.
  2. Remove any other adapter such as `nitro()`.
  3. Set the Vite plugins to `cloudflare({ viteEnvironment: { name: "ssr" } })`, `tanstackStart()`, `react()`.
  4. Add a `wrangler.jsonc` with `"main": "@tanstack/react-start/server-entry"`, a `compatibility_date`, and observability enabled.
  5. Scripts: `vite dev`, `vite build`, `vite preview`, `wrangler deploy`, `wrangler types`.
- **Not supported:** TanStack Start on Rsbuild. The guide says to migrate to Vite first.

**Bindings (D1, KV, env)**

- Import `env` from `cloudflare:workers` in server-side code, such as `createServerFn().handler(...)` or server-route handlers. Generate the `Env` types with `wrangler types` (same guide, "Bindings" section; the [Workers bindings doc](https://developers.cloudflare.com/workers/runtime-apis/bindings/#importing-env-as-a-global) covers importing `env` as a global).
- Server routes are `createFileRoute('/path')({ server: { handlers: { GET, POST, ... } } })` and support splat paths (`routes/api/file/$.ts` gives `/api/file/$`). TanStack's docs describe them as the place for raw HTTP endpoints called from outside the app ([Server Routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)).

**Custom entry (Cron Triggers, Queues, Durable Objects, Workflows)**

- Create `src/server.ts` that imports `handler` from `@tanstack/react-start/server-entry`. Export `{ fetch: handler.fetch, scheduled, queue }` and named DO/Workflow classes, then point Wrangler `main` at `src/server.ts` (Cloudflare guide, "Custom entrypoints").
- Locally, `curl "http://localhost:3000/cdn-cgi/local/scheduled?cron=*+*+*+*+*"` triggers `scheduled`.
- TanStack's own form is `createServerEntry({ fetch(request, opts) { return handler.fetch(request, opts) } })`. Start detects `src/server.ts` automatically ([Server Entry Point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point)).

**One Worker for UI + high-throughput `/p/:provider/*`, or a separate Worker?**

Documented facts:

- **Same Worker, Start server route.** A splat server route (for example `routes/p/$provider/$.ts`) receives the raw `Request` and returns a `Response`.
- **Same Worker, custom entry.** Because the custom entry is a plain fetch handler, it can route `/p/*` to other code, such as a Hono app, before calling `handler.fetch`. *Inference:* neither doc shows a Hono example, but the documented handler shape allows it.
- **Separate Worker.** Service bindings let one Worker call another's RPC or `fetch` without going over the Internet. A plain global `fetch()` to another Worker on the same zone fails without a service binding ([limits: Worker-to-Worker](https://developers.cloudflare.com/workers/platform/limits/#worker-to-worker-subrequests)). The TanStack guide includes a service-binding example.
- **Static assets.** Matching static assets are served before the Worker runs, unless `assets.run_worker_first` is set (a boolean or an array of paths). If Smart Placement is combined with `run_worker_first`, the whole Worker is placed as one unit, which can split edge-first and smart-placed behavior badly ([static assets routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)).
- **Whole-bundle limits.** The 64 MiB size limit and the 1 s global-scope startup limit apply to the entire Worker bundle ([limits](https://developers.cloudflare.com/workers/platform/limits/)). *Inference:* a proxy route in the same Worker shares an isolate, memory (128 MB per isolate) and startup cost with the SSR bundle.
- **No official recommendation either way.** I found no Cloudflare or TanStack doc that recommends a separate Worker for API or proxy traffic. Both patterns are documented. [backpine/tanstack-trpc-on-cloudflare](https://github.com/backpine/tanstack-trpc-on-cloudflare) is a community example serving frontend and API from one Worker.

**Known limitations and gotchas**

- Rsbuild is not supported.
- Static prerendering at build time uses local bindings and env unless remote bindings are configured. In CI, set `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` (Cloudflare guide, "Prerendering data sources").
- A user write-up attributes TanStack Start + Cloudflare dev HMR failures to a bug in the Cloudflare Vite plugin, fixed by upgrading ([gist](https://gist.github.com/joshmatz/e26ba38aaf5b087809c01de5d25e05ec)).
- The open vite-plus issues #1671 and #2481 are listed in A1.

## A3. Drizzle ORM with Cloudflare D1

**Versions and release status**

| Package | npm `latest` | `rc` tag | Notes |
| --- | --- | --- | --- |
| drizzle-orm | 0.45.4 (2026-10-08) | 1.0.0-rc.5 (2026-10-21) | Drizzle's docs now tell you to install `drizzle-orm@rc` and `drizzle-kit@rc` ([D1 page](https://orm.drizzle.team/docs/connect-cloudflare-d1)) |
| drizzle-kit | 0.31.11 | 1.0.0-rc.5 | |
| drizzle-zod | 0.8.3 (published 2025-08-06) | (no rc; beta tags only) | peers: `zod ^3.25.0 \|\| ^4.0.0`, `drizzle-orm >=0.36.0` |
| zod | 4.6.7 | | Cloudflare's limits page advises Zod ≥ 4.5.0 because earlier versions use much more memory per schema ([limits: memory](https://developers.cloudflare.com/workers/platform/limits/#memory)) |

**Driver**

- Import `drizzle` from `drizzle-orm/d1` and call `drizzle(env.DB)`. The binding is declared in `d1_databases` in Wrangler with `binding`, `database_name`, `database_id` and optionally `migrations_dir` ([Drizzle D1](https://orm.drizzle.team/docs/connect-cloudflare-d1)).
- The 1.0.0-rc.5 tarball also ships `drizzle-orm/durable-sqlite` and `drizzle-orm/effect-d1`.

**Built-in Zod schemas**

- The v1 RC has `drizzle-orm/zod` built in. The 1.0.0-rc.5 tarball contains `zod`, `valibot`, `typebox`, `typebox-legacy`, `arktype` and `effect-schema` entry points, with `zod ^3.25.0 || ^4.0.0` as an optional peer.
- Docs: `createSelectSchema`, `createInsertSchema`, `createUpdateSchema` and `createSchemaFactory` (supports `zodInstance` and `coerce`) from `drizzle-orm/zod`. Examples import `z` from `zod/v4` ([Drizzle zod](https://orm.drizzle.team/docs/zod)).
- On stable 0.45.x, the separate `drizzle-zod` package is the route, and it accepts Zod 4.

**Migrations**

- **drizzle-kit over the D1 HTTP API.** In `drizzle.config.ts` set `dialect: 'sqlite'`, `driver: 'd1-http'`, and `dbCredentials: { accountId, databaseId, token }` (token needs D1 edit permission). This enables `migrate`, `push`, `introspect` and `studio` against remote D1 ([guide](https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit)).
- **Wrangler.** `wrangler d1 migrations apply <db> [--local|--remote]` reads `.sql` files in `migrations_dir` and records applied files in `d1_migrations`; the table name can be changed with `migrations_table`.
- **Nested layout.** Drizzle v1 writes each migration as a subdirectory (`migrations/0001_init/migration.sql`). Set `migrations_pattern` (for example `"migrations/*/migration.sql"`, which must start with `migrations_dir`) so Wrangler finds them. `wrangler d1 migrations create` only writes top-level files, so generate migrations with `drizzle-kit generate` ([D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)). Drizzle's tracking issue [#5266](https://github.com/drizzle-team/drizzle-orm/issues/5266) closed 2026-06-20.
- **Local dev.** The Vite plugin and `wrangler dev` use a local D1 (Miniflare). Migrations are applied to it with `--local`. To prerender with production data, use remote bindings (Cloudflare TanStack guide).

## A4. Cloudflare limits relevant to a reverse proxy

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 2026-10-29), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (2026-10-30), [KV limits](https://developers.cloudflare.com/kv/platform/limits/) (2026-10-30), [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

**Workers**

| Limit | Free | Paid |
| --- | --- | --- |
| Requests | 100,000/day (error 1027 when exceeded; fail-open or fail-closed is configurable per route) | no limit |
| CPU time per HTTP request | 10 ms | default 30 s, configurable up to 5 min (`limits.cpu_ms`) |
| CPU per Cron Trigger | 10 ms | 30 s (interval < 1 h) / 15 min (interval ≥ 1 h) |
| Wall time, HTTP | unlimited while the client is connected; `ctx.waitUntil()` up to 30 s after the response | same |
| Wall time, Cron | 15 min | 15 min |
| Memory | 128 MB per isolate | same |
| Subrequests per invocation | 50 (1,000 to internal services) | 10,000 default, configurable up to 10M |
| Simultaneous connections waiting for headers | 6 | 6 |
| Cron Triggers per account | 5 | 250 |
| Worker size / startup | 64 MiB uncompressed / 1 s | same |
| URL / request headers / response headers | 16 KB / 128 KB / 128 KB | same |
| Request body | depends on the **zone** plan: Free and Pro 100 MB, Business 200 MB, Enterprise up to 5 GB | |
| Response body | no enforced limit (CDN cache limits are separate) | |

CPU time excludes time spent waiting on `fetch`, KV or D1. The page puts the average Worker at about 2.2 ms per request.

**D1**

- **Usage allowances.** Free: 5M rows read and 100k rows written per day, 500 MB per database, 10 databases. Paid: 25B rows read and 50M rows written per month included, then $0.001 per million reads and $1.00 per million writes; 10 GB per database (cannot be raised).
- **Per-invocation query limit.** 1,000 queries per invocation on Paid and 50 on Free. A `db.batch()` counts as one query.
- **Statement limits.** 100 bound parameters per query, 100 KB per statement, 30 s per query, 2 MB per row, and a 50 MB result size (in force from 2026-11-04).
- **Throughput.** Each database is single-threaded and backed by one Durable Object, so throughput is roughly 1 / query duration (1 ms gives about 1,000 queries per second). Excess requests queue first, then return an "overloaded" error.
- **Latency.** Indexed reads take under 1 ms of SQL time. Writes take several ms because they are persisted to several locations. D1 reports SQL duration only, with a small per-request overhead on top. The docs give no end-to-end latency figure. *Inference:* network time from the Worker to the database's location adds to it. Read replication exists ([read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).

**KV**

- **Limits.** Free: 100k reads/day and 1,000 writes/day to different keys. Paid: unlimited. Both plans: **1 write per second to the same key**, 1,000 operations per invocation, 25 MiB values, 512 B keys, and a minimum `cacheTtl` of 30 s (default 60 s).
- **Consistency.** Eventually consistent. A change is usually visible at once in the location that wrote it, though that is not guaranteed. Other locations can take **up to 60 s or more**. Negative lookups are cached too, so newly created keys show the same delay. The docs suggest Durable Objects when atomic or strongly consistent operations are needed.
- KV Instant is in private beta: 1 write/s per namespace, 1 MB per namespace.

**Cron Triggers** are available on both plans (5 or 250 per account, CPU limits as in the table). In TanStack Start they are wired through the custom entry's `scheduled` export (A2).

## A5. Wallet connection (EVM ERC-191 `personal_sign`, optional NEAR)

- **EVM: wagmi 3.7.11 + viem 2.57.17** (both MIT). wagmi's peers are `viem 2.x`, `react >=18`, `@tanstack/react-query >=5`, `typescript >=5.9.3`. `signMessage` in wagmi and viem is EIP-191 `personal_sign`.
- **Server-side verification.** viem's public action `publicClient.verifyMessage` verifies EOAs plus smart accounts: deployed (ERC-1271), pre-deployed (ERC-6492) and pre-delegated (ERC-8010). The standalone `verifyMessage` utility handles EOAs only ([viem verifyMessage](https://viem.sh/docs/actions/public/verifyMessage)). The public action needs an RPC transport.
- **Connect UI options:** RainbowKit 2.2.11 (MIT). Reown AppKit 1.8.24, whose npm license field reads "SEE LICENSE IN LICENSE.md", so check its terms.
- **NEAR: `@hot-labs/near-connect` 0.12.0** (2026-10-26, MIT, repo [hot-dao/near-selector](https://github.com/hot-dao/near-selector)). It is a zero-dependency connector that runs each wallet's integration script in a sandbox.
  - The manifest lists HOT, Meteor, Intear, MyNearWallet, Nightly, Near Mobile, Unity, OKX, Hana, "Ethereum Wallets", NEAR CLI, and WalletConnect (optional, through a `SignClient`).
  - `connector.connect({ signMessageParams: { message, recipient, nonce } })` signs in and signs a NEP-413 message in one step and emits `wallet:signInAndSignMessage`.
  - `near-connect-hooks` 1.1.6 provides React hooks on top of it. `@hot-labs/kit` 1.6.4 is HOT's chain-agnostic connector.
- **Intents signing standards.** NEAR Intents accepts `erc191`, `nep413` and `raw_ed25519` signed payloads (see [near-intents.md](./near-intents.md), Message Bus section).

---

# Part B: deposit-minimum seed data

## B1. How the data was fetched

```http
POST https://bridge.chaindefuser.com/rpc
{"jsonrpc":"2.0","id":"1","method":"supported_tokens","params":[{}]}
```

The optional filter `params: [{"chains": ["eth:137", ...]}]` is typed in `@defuse-protocol/internal-utils` 0.45.0 (`poaBridgeHttpClient/types.d.ts`).

Facts about the response:

- **Shape.** Each entry has `intents_token_id`, `standard`, `near_token_id`, `multi_token_id` (nep245 only), `asset_name`, `decimals`, `min_deposit_amount`, `min_withdrawal_amount`, `withdrawal_fee`, `defuse_asset_identifier` and `origin_chain_address`.
- **`defuse_asset_identifier` is deprecated.** The SDK types mark it as an internal PoA Bridge id that client code should not rely on. The `chain` argument of `deposit_address` (for example `eth:8453`) is still that id's `blockchain:network` prefix.
- **Size.** The call at 20:45:12 UTC returned **253 tokens across 38 chain ids**.
- **Stablecoin rows in the table below:** USDC 16, USDT 14, USDT0 6, USDC.e 1, for 37 rows. The remaining **216 entries (154 distinct symbols)** are not listed here.
- **Token id families across all 253:** `*.omft.near` (PoA-minted) 138, plain NEAR-native nep141 42, `*.omdep.near` (Omni) 39, `nep245:v2_1.omni.hot.tg:*` (HOT) 34.

1Click: `GET https://1click.chaindefuser.com/v0/tokens` returned 216 assets (prices `priceUpdatedAt` 2026-11-09T20:44:30.840Z).

## B2. USDC / USDT minimum table (live, 2026-11-09 20:45 UTC)

The "Id family" column gives the family of the credited Intents token id. It does not always name the bridge that physically sweeps the deposit: for example, Solana USDC is swept through `omni.bridge.near` but credited as an `omft` token ([static-deposit-address.md](./static-deposit-address.md) §2). "1Click price" is the USD price from `/v0/tokens` for the same `assetId`.

| # | Chain | CAIP-2 | Token | Origin contract | Dec | Min deposit (human) | Min deposit (base units) | Min withdrawal (human) | Withdrawal fee (human) | Intents token id | Id family | 1Click price |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Ethereum | `eip155:1` | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | 0.001 | 1000 | 0.000001 | 0.3 | `nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near` | PoA (omft) | 0.999459 |
| 2 | Ethereum | `eip155:1` | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | 0.001 | 1000 | 0.000001 | 0.3 | `nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near` | PoA (omft) | 0.999063 |
| 3 | Base | `eip155:8453` | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | **0.15** | 150000 | 0.000001 | 0.0024 | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` | PoA (omft) | 0.999459 |
| 4 | Arbitrum One | `eip155:42161` | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | 0.001 | 1000 | 0.000001 | 0.0053 | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` | PoA (omft) | 0.999459 |
| 5 | Arbitrum One | `eip155:42161` | USDT0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | 0.001 | 1000 | 0.000001 | 0.0053 | `nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near` | PoA (omft) | 0.998932 |
| 6 | Gnosis | `eip155:100` | USDC | `0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0` | 6 | 0.001 | 1000 | 0.000001 | 0.000037 | `nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near` | PoA (omft) | 0.999459 |
| 7 | Gnosis | `eip155:100` | USDT | `0x4ECaBa5870353805a9F068101A40E0f32ed605C6` | 6 | 0.001 | 1000 | 0.000001 | 0.000037 | `nep141:gnosis-0x4ecaba5870353805a9f068101a40e0f32ed605c6.omft.near` | PoA (omft) | 0.999063 |
| 8 | BNB Chain | `eip155:56` | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | 0.001 | 1000000000000000 | 1e-18 | 0.03 | `nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r` | HOT | 0.999459 |
| 9 | BNB Chain | `eip155:56` | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | 1e-18 ⁽ᵇ⁾ | 1 | 1e-18 | 0.03 | `nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g` | HOT | 0.999063 |
| 10 | Polygon PoS | `eip155:137` | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 | 0.001 | 1000 | 0.000001 | 0.001 | `nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L` | HOT | 0.999459 |
| 11 | Polygon PoS | `eip155:137` | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 | 0.001 | 1000 | 0.000001 | 0.001 | `nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr` | HOT | 0.999063 |
| 12 | OP Mainnet | `eip155:10` | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ` | HOT | 0.999459 |
| 13 | OP Mainnet | `eip155:10` | USDT | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo` | HOT | 0.999063 |
| 14 | OP Mainnet | `eip155:10` | USDT0 | `0x01bFF41798a0BcF287b996046Ca68b395DbC1071` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:10_2R1RXDBxCyJTeMEsdXydh7xsHmz` | HOT | 0.998932 |
| 15 | Avalanche C-Chain | `eip155:43114` | USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o` | HOT | 0.999459 |
| 16 | Avalanche C-Chain | `eip155:43114` | USDT | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp` | HOT | 0.999063 |
| 17 | Berachain | `eip155:80094` | USDT0 | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 | 0.001 | 1000 | 0.000001 | 0.003 | `nep141:bera-0x779ded0c9e1022225f8e0630b35a9b54be713736.omft.near` | PoA (omft) | 0.998932 |
| 18 | Monad | `eip155:143` | USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx` | HOT | 0.999459 |
| 19 | Monad | `eip155:143` | USDT0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et` | HOT | 0.998932 |
| 20 | X Layer | `eip155:196` | USDC | `0x74b7F16337b8972027F6196A17a631aC6dE26d22` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:196_2dK9kLNR7Ekq7su8FxNGiUW3djTw` | HOT | 0.999459 |
| 21 | X Layer | `eip155:196` | USDT0 | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:196_2fezDCvVYRsG8wrK6deJ2VRPiAS1` | HOT | 0.998932 |
| 22 | Plasma | `eip155:9745` | USDT0 | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | 6 | 0.001 | 1000 | 0 | 0.000005 | `nep141:plasma-0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb.omft.near` | PoA (omft) | 0.998932 |
| 23 | Scroll | `eip155:534352` | USDT | `0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df` | 6 | 0.001 | 1000 | 0.000001 | 0 | `nep245:v2_1.omni.hot.tg:534352_4RG3Q2wFsMQmd45m5m89RjsLfupA` | HOT | 0.999063 |
| 24 | ADI | `eip155:36900` | USDC.e | `0x9cb8142aEBBcdc60AF7c97Af897A67A8f3CA71C2` | 6 | 0.001 | 1000 | 0.000001 | 0.3 | `nep141:adi-0x9cb8142aebbcdc60af7c97af897a67a8f3ca71c2.omft.near` | PoA (omft) | not listed |
| 25 | Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 | 0.001 | 1000 | 0.000001 | 0.03 | `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near` | PoA (omft) ⁽ˢ⁾ | 0.999459 |
| 26 | Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 | 0.001 | 1000 | 0.000001 | 0.03 | `nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near` | PoA (omft) | 0.999063 |
| 27 | Tron | `tron:728126428` | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 | **1** | 1000000 | 1 | 1 | `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` | PoA (omft) | 0.999063 |
| 28 | NEAR | `near:mainnet` ⁽ⁿ⁾ | USDC | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | 6 | 0.000001 | 1 | 0.000001 | 0 | `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | NEAR-native | 0.999459 |
| 29 | NEAR | `near:mainnet` ⁽ⁿ⁾ | USDT | `usdt.tether-token.near` | 6 | 0.000001 | 1 | 0.000001 | 0 | `nep141:usdt.tether-token.near` | NEAR-native | 0.999063 |
| 30 | TON | `tvm:-239` | USDT | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` | 6 | 0.001 | 1000 | 1 | 0 | `nep245:v2_1.omni.hot.tg:1117_3tsdfyziyc7EJbP2aULWSKU4toBaAcN4FdTgfm5W1mC4ouR` | HOT | 0.999063 |
| 31 | Aptos | `aptos:1` | USDC | `0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b` | 6 | 0.000001 | 1 | 0.000001 | 0.0025 | `nep141:aptos-34ee497f210c5a511e8d5b53bc56d75b63612bb5.omft.near` | PoA (omft) | 0.999459 |
| 32 | Aptos | `aptos:1` | USDT | `0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b` | 6 | 0.000001 | 1 | 0.000001 | 0.0025 | `nep141:aptos-88cb7619440a914fe6400149a12b443c3ac21d59.omft.near` | PoA (omft) | 0.999063 |
| 33 | Sui | `sui:mainnet` | USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` | 6 | 0.000001 | 1 | 0.000001 | 0.02 | `nep141:sui-c1b81ecaf27933252d31a963bc5e9458f13c18ce.omft.near` | PoA (omft) | 0.999459 |
| 34 | Sui | `sui:mainnet` | USDT | `0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT` | 6 | 0.000001 | 1 | 0.000001 | 0.02 | `nep141:sui-349a5b23674603c086ceac1fa9f139c4bbc30cf8.omft.near` | PoA (omft) | not listed |
| 35 | Stellar | `stellar:pubnet` | USDC | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | 7 | 0.01 | 100000 | 0.0000001 | 0 | `nep245:v2_1.omni.hot.tg:1100_111bzQBB65GxAPAVoxqmMcgYo5oS3txhqs1Uh1cgahKQUeTUq1TJu` | HOT ⁽ᵐᵉᵐᵒ⁾ | 0.999459 |
| 36 | Hyperliquid HyperCore | – ⁽ʰ⁾ | USDC | `0x6d1e7cde53ba9467b783cb7c530ce054` | 8 | 0.5 | 50000000 | 0 | 0 | `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near` ⁽ʰ⁾ | PoA (omft) | 0.999459 (Arbitrum USDC id) |
| 37 | Miden | – | USDT | `0x5cb79d29507d3ad17bb6dc60279e89` | 6 | 0.01 | 10000 | 0.01 | 0.01 | `nep141:miden-0x5cb79d29507d3ad17bb6dc60279e89.omft.near` | PoA (omft) | 0.999063 |

Notes:

- ⁽ᵇ⁾ **BNB USDT** reports `min_deposit_amount: "1"` (1 wei at 18 decimals), while BNB USDC reports 1e15 (0.001). It may be a placeholder; the value is undocumented.
- ⁽ˢ⁾ **Solana USDC** deposits are swept through Omni (Wormhole) but credited as the `omft` token (observed in [static-deposit-address.md](./static-deposit-address.md)).
- ⁽ⁿ⁾ **NEAR** has no namespace in the [ChainAgnostic namespaces](https://github.com/ChainAgnostic/namespaces) repo. `near:mainnet` is informal.
- ⁽ʰ⁾ **HyperCore** has no CAIP-2 entry. Its bridge row credits the *Arbitrum* USDC Intents id. 1Click lists HyperCore USDC under separate ids: `1cs_v1:hypercore:hip1:0x6d1e…e054` (8 decimals) and `1cs_v1:hypercore:erc20:0xb883…630f` (6 decimals).
- ⁽ᵐᵉᵐᵒ⁾ **Stellar:** `deposit_address` without `deposit_mode` returned `{"error":"Deposit mode MEMO is required for this chain"}`. The SDK types say the response then carries a `memo`.
- **CAIP-2 sources.** Tron uses the decimal form `tron:728126428`; the hex form `tron:0x2b6653dc` is a deprecated alias. TON is `tvm:-239`, Aptos `aptos:1`, Stellar `stellar:pubnet`, Sui `sui:mainnet` (ChainAgnostic `*/caip2.md`). EVM chains use `eip155:<chainId>`, and Solana mainnet uses the genesis-hash prefix.
- **Highest minimums:** Tron USDT 1.0, HyperCore USDC 0.5, Base USDC 0.15, Stellar USDC 0.01, Miden USDT 0.01. All other EVM and Solana USDC/USDT rows are 0.001.
- **Unchanged.** Base USDC 0.15 and the 0.001 minimums elsewhere match the values recorded around 20:07 UTC in [static-deposit-address.md](./static-deposit-address.md).
- **1Click cross-reference.** Every row's `intents_token_id` appears verbatim as a 1Click `assetId`, except **Sui USDT** and **ADI USDC.e**, which are not listed. 1Click decimals match the bridge everywhere, including BNB 18.
  - Prices at 20:44:30Z: USDC 0.999459, USDT 0.999063, USDT0 0.998932.
  - 1Click `blockchain` slugs for these rows: `eth, base, arb, gnosis, bsc, pol, op, avax, bera, monad, xlayer, plasma, scroll, sol, tron, near, ton, aptos, sui, stellar, miden`.

## B3. Omni / HOT migration status and deposit-address paths

**Docs say:** the [2026-11-09 changelog](https://docs.near-intents.org/changelog/entries/2026-11-09-evm-omni-token-ids.md) states that BNB Chain, Polygon and Avalanche tokens now use Omni `nep141:….omdep.near` asset ids instead of HOT `nep245:v2_1.omni.hot.tg:…`, and tells integrators to replace hardcoded ids. The new stablecoin ids it lists:

| Chain | Token | Legacy HOT id (still live in both APIs) | New Omni id (per changelog) |
| --- | --- | --- | --- |
| BNB | USDC | `nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r` | `nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near` |
| BNB | USDT | `nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g` | `nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near` |
| Polygon | USDC | `nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L` | `nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near` |
| Polygon | USDT | `nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr` | `nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near` |
| Avalanche | USDC | `nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o` | `nep141:avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near` |
| Avalanche | USDT | `nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp` | `nep141:avax-0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7.omdep.near` |

**Live state, 20:45-21:00 UTC:**

- Both PoA `supported_tokens` and 1Click `/v0/tokens` still list the **HOT** ids for USDC/USDT on chains 56, 137 and 43114. With `chains: ["eth:137"]`, `supported_tokens` returned POL, USDC, USDT and WETH as HOT ids, plus one Omni token (COCA, `pol-0x7b12….omdep.near`). In 1Click, the omdep ids present are only a handful of non-stable tokens (Polygon COCA, Solana USD1/PENGU, and others).
- The Omni stablecoin contracts already exist on NEAR with near-zero supply (`ft_total_supply` via `rpc.mainnet.near.org`):

  | Contract | Supply |
  | --- | --- |
  | `pol-0x3c49…3359.omdep.near` (USDC, 6 dec) | 31457042 (31.457042 USDC) |
  | `bnb-0x8ac7…580d.omdep.near` (USDC, 18 dec) | 1e12 (0.000001) |
  | `avax-0xb97e…8a6e.omdep.near` (USDC, 6 dec) | 1 (0.000001) |
  | `bnb-0x55d3…7955.omdep.near` (USDT) | 0 |

  *Inference:* the migration is announced but not yet reflected in the token lists.
- **Minimums for the Omni ids:** none are published. `supported_tokens` has no rows for them yet, so no Omni minimum exists for these six tokens today.

**Does `deposit_address` return addresses for those chains?** Yes, checked at 20:46:56 UTC for `herald-test.near`:

- Chains `eth:137`, `eth:56`, `eth:43114`, `eth:10`, `eth:143`, `eth:196`, `eth:534352`, `eth:9745`, `eth:8453`, `eth:42161` and `eth:1` all returned the same address, `0xa16d4873c23FF827b7aF33914b696199e3c35D23`. It is unchanged since the 20:10 run.
- `sol:mainnet` returned `NPyGV1D3…TzS` and `tron:mainnet` returned `TQgscX1q…FoSy`, both unchanged.
- `stellar:mainnet` needs `deposit_mode: "MEMO"`.

**Separate deposit APIs for Omni and HOT** (SDK source read from the npm tarballs):

- **Omni Bridge (Near One).**
  - Docs: Omni is used for Ethereum, Base, Arbitrum, BNB, Solana and Bitcoin. Inbound proofs come from light clients (BTC, ETH) or Wormhole (Solana and some L2s). Requesting a deposit address only derives it from a public key ([Omni overview](https://docs.near-intents.org/learn/omni-bridge/overview.md), [bridges overview](https://docs.near-intents.org/integration/bridging/overview.md)).
  - The SDKs (`@omni-bridge/core` 0.21.0, 2026-10-29; `omni-bridge-sdk` 0.23.3) call `https://mainnet.api.bridge.nearone.org`. Their only deposit-address endpoint is `/api/v3/utxo/get_user_deposit_address` (UTXO chains). The other endpoints are `/api/v3/transfer-fee`, `/api/v3/transfer-fee/allowlisted-tokens` and `/api/v4/transfers*`.
  - I found no EVM static-address endpoint and no stablecoin-minimum endpoint. `transfer-fee` was not queried.
- **HOT Bridge.**
  - Docs: HOT serves BNB, Polygon, Optimism, Avalanche, Scroll, Monad, TON, Stellar, X Layer, ADI and Plasma ([bridges overview](https://docs.near-intents.org/integration/bridging/overview.md)). The live list differs: ADI USDC.e and Plasma USDT0 show `omft` ids, not HOT ids.
  - `@hot-labs/omni-sdk` 2.25.5: on EVM, deposit is a contract call, `deposit(bytes receiver, address contract_id, uint128 amount)`, on the HOT treasury contract (default `0x233c5370CCfb3cD7409d9A3fb98ab94dE94Cb4Cd`). On Solana, deposit uses a per-nonce PDA. Neither is a static address. HOT's API hosts are `api.hot-labs.org` and `rpc1/rpc2.hotdao.ai`.
- **`@defuse-protocol/intents-sdk` 0.95.0:** its `omni-bridge` and `hot-bridge` modules only cover withdrawals. Static deposit addresses come only from the PoA bridge client (`deposit_address`, `recent_deposits`).

*Inference:* for x402 `payTo` on HOT or Omni chains, the static-address source today is `bridge.chaindefuser.com` `deposit_address`. The HOT and Omni native deposit paths need the payer to call a contract.

---

## Appendix: raw responses (trimmed)

### `supported_tokens` (2026-11-09T20:45:12Z), stablecoin rows only

`origin_chain_address`, `near_token_id`, `standard` and `multi_token_id` are omitted here because they are in the table above.

```json
{"defuse_asset_identifier":"eth:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","intents_token_id":"nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"300000"}
{"defuse_asset_identifier":"eth:1:0xdac17f958d2ee523a2206206994597c13d831ec7","intents_token_id":"nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"300000"}
{"defuse_asset_identifier":"eth:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","intents_token_id":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"150000","min_withdrawal_amount":"1","withdrawal_fee":"2400"}
{"defuse_asset_identifier":"eth:42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831","intents_token_id":"nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"5300"}
{"defuse_asset_identifier":"eth:42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9","intents_token_id":"nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"5300"}
{"defuse_asset_identifier":"eth:100:0x2a22f9c3b484c3629090feed35f17ff8f88f76f0","intents_token_id":"nep141:gnosis-0x2a22f9c3b484c3629090feed35f17ff8f88f76f0.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"37"}
{"defuse_asset_identifier":"eth:100:0x4ecaba5870353805a9f068101a40e0f32ed605c6","intents_token_id":"nep141:gnosis-0x4ecaba5870353805a9f068101a40e0f32ed605c6.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"37"}
{"defuse_asset_identifier":"eth:56:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d","intents_token_id":"nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r","decimals":18,"asset_name":"USDC","min_deposit_amount":"1000000000000000","min_withdrawal_amount":"1","withdrawal_fee":"30000000000000000"}
{"defuse_asset_identifier":"eth:56:0x55d398326f99059ff775485246999027b3197955","intents_token_id":"nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g","decimals":18,"asset_name":"USDT","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"30000000000000000"}
{"defuse_asset_identifier":"eth:137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359","intents_token_id":"nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"1000"}
{"defuse_asset_identifier":"eth:137:0xc2132d05d31c914a87c6611c10748aeb04b58e8f","intents_token_id":"nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"1000"}
{"defuse_asset_identifier":"eth:10:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85","intents_token_id":"nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:10:0x94b008aA00579c1307B0EF2c499aD98a8ce58e58","intents_token_id":"nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:10:0x01bff41798a0bcf287b996046ca68b395dbc1071","intents_token_id":"nep245:v2_1.omni.hot.tg:10_2R1RXDBxCyJTeMEsdXydh7xsHmz","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:43114:0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E","intents_token_id":"nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:43114:0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7","intents_token_id":"nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:80094:0x779Ded0c9e1022225f8E0630b35a9b54bE713736","intents_token_id":"nep141:bera-0x779ded0c9e1022225f8e0630b35a9b54be713736.omft.near","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"3000"}
{"defuse_asset_identifier":"eth:143:0x754704Bc059F8C67012fEd69BC8A327a5aafb603","intents_token_id":"nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:143:0xe7cd86e13AC4309349F30B3435a9d337750fC82D","intents_token_id":"nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:196:0x74b7f16337b8972027f6196a17a631ac6de26d22","intents_token_id":"nep245:v2_1.omni.hot.tg:196_2dK9kLNR7Ekq7su8FxNGiUW3djTw","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:196:0x779ded0c9e1022225f8e0630b35a9b54be713736","intents_token_id":"nep245:v2_1.omni.hot.tg:196_2fezDCvVYRsG8wrK6deJ2VRPiAS1","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:9745:0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb","intents_token_id":"nep141:plasma-0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb.omft.near","decimals":6,"asset_name":"USDT0","min_deposit_amount":"1000","min_withdrawal_amount":"0","withdrawal_fee":"5"}
{"defuse_asset_identifier":"eth:534352:0xf55bec9cafdbe8730f096aa55dad6d22d44099df","intents_token_id":"nep245:v2_1.omni.hot.tg:534352_4RG3Q2wFsMQmd45m5m89RjsLfupA","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"eth:36900:0x9cb8142aebbcdc60af7c97af897a67a8f3ca71c2","intents_token_id":"nep141:adi-0x9cb8142aebbcdc60af7c97af897a67a8f3ca71c2.omft.near","decimals":6,"asset_name":"USDC.e","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"300000"}
{"defuse_asset_identifier":"sol:mainnet:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","intents_token_id":"nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"30000"}
{"defuse_asset_identifier":"sol:mainnet:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB","intents_token_id":"nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1","withdrawal_fee":"30000"}
{"defuse_asset_identifier":"tron:mainnet:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","intents_token_id":"nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000000","min_withdrawal_amount":"1000000","withdrawal_fee":"1000000"}
{"defuse_asset_identifier":"near:mainnet:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","intents_token_id":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","decimals":6,"asset_name":"USDC","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"near:mainnet:usdt.tether-token.near","intents_token_id":"nep141:usdt.tether-token.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"ton:mainnet:EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs","intents_token_id":"nep245:v2_1.omni.hot.tg:1117_3tsdfyziyc7EJbP2aULWSKU4toBaAcN4FdTgfm5W1mC4ouR","decimals":6,"asset_name":"USDT","min_deposit_amount":"1000","min_withdrawal_amount":"1000000","withdrawal_fee":"0"}
{"defuse_asset_identifier":"aptos:mainnet:0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b","intents_token_id":"nep141:aptos-34ee497f210c5a511e8d5b53bc56d75b63612bb5.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"2500"}
{"defuse_asset_identifier":"aptos:mainnet:0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b","intents_token_id":"nep141:aptos-88cb7619440a914fe6400149a12b443c3ac21d59.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"2500"}
{"defuse_asset_identifier":"sui:mainnet:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC","intents_token_id":"nep141:sui-c1b81ecaf27933252d31a963bc5e9458f13c18ce.omft.near","decimals":6,"asset_name":"USDC","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"20000"}
{"defuse_asset_identifier":"sui:mainnet:0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT","intents_token_id":"nep141:sui-349a5b23674603c086ceac1fa9f139c4bbc30cf8.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"1","min_withdrawal_amount":"1","withdrawal_fee":"20000"}
{"defuse_asset_identifier":"stellar:mainnet:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN","intents_token_id":"nep245:v2_1.omni.hot.tg:1100_111bzQBB65GxAPAVoxqmMcgYo5oS3txhqs1Uh1cgahKQUeTUq1TJu","decimals":7,"asset_name":"USDC","min_deposit_amount":"100000","min_withdrawal_amount":"1","withdrawal_fee":"0"}
{"defuse_asset_identifier":"hypercore:mainnet:0x6d1e7cde53ba9467b783cb7c530ce054","intents_token_id":"nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near","decimals":8,"asset_name":"USDC","min_deposit_amount":"50000000","min_withdrawal_amount":"0","withdrawal_fee":"0"}
{"defuse_asset_identifier":"miden:mainnet:0x5cb79d29507d3ad17bb6dc60279e89","intents_token_id":"nep141:miden-0x5cb79d29507d3ad17bb6dc60279e89.omft.near","decimals":6,"asset_name":"USDT","min_deposit_amount":"10000","min_withdrawal_amount":"10000","withdrawal_fee":"10000"}
```

Response envelope: `{"id":"1","jsonrpc":"2.0","result":{"tokens":[…253 entries…]}}`. The 38 chain ids: `aleo, aptos, bch, btc, cardano, dash, doge, eth:1, eth:10, eth:100, eth:137, eth:143, eth:196, eth:36900, eth:42161, eth:43114, eth:4663, eth:534352, eth:56, eth:80094, eth:8453, eth:9745, fogo, hypercore, ltc, miden, movement, near, prl, qtc, sol, starknet, stellar, sui, ton, tron, xrp, zec` (non-EVM ones are `<name>:mainnet`).

### 1Click `GET /v0/tokens` (2026-11-09, `priceUpdatedAt` 20:44:30.840Z), matching rows

Each row's `assetId` equals the `intents_token_id` in the table. `contractAddress` is the lowercase form of the origin contract.

```text
eth      USDC   dec=6  price=0.999459    eth      USDT   dec=6  price=0.999063
base     USDC   dec=6  price=0.999459    arb      USDC   dec=6  price=0.999459
arb      USDT0  dec=6  price=0.998932    gnosis   USDC   dec=6  price=0.999459
gnosis   USDT   dec=6  price=0.999063    bsc      USDC   dec=18 price=0.999459
bsc      USDT   dec=18 price=0.999063    pol      USDC   dec=6  price=0.999459
pol      USDT   dec=6  price=0.999063    op       USDC   dec=6  price=0.999459
op       USDT   dec=6  price=0.999063    op       USDT0  dec=6  price=0.998932
avax     USDC   dec=6  price=0.999459    avax     USDT   dec=6  price=0.999063
bera     USDT0  dec=6  price=0.998932    monad    USDC   dec=6  price=0.999459
monad    USDT0  dec=6  price=0.998932    xlayer   USDC   dec=6  price=0.999459
xlayer   USDT0  dec=6  price=0.998932    plasma   USDT0  dec=6  price=0.998932
scroll   USDT   dec=6  price=0.999063    sol      USDC   dec=6  price=0.999459
sol      USDT   dec=6  price=0.999063    tron     USDT   dec=6  price=0.999063
near     USDC   dec=6  price=0.999459    near     USDT   dec=6  price=0.999063
ton      USDT   dec=6  price=0.999063    aptos    USDC   dec=6  price=0.999459
aptos    USDT   dec=6  price=0.999063    sui      USDC   dec=6  price=0.999459
stellar  USDC   dec=7  price=0.999459    miden    USDT   dec=6  price=0.999063
hypercore USDC  dec=8  assetId=1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054
hypercore USDC  dec=6  assetId=1cs_v1:hypercore:erc20:0xb88339CB7199b77E23DB6E890353E22632Ba630f
not listed: sui USDT (nep141:sui-349a…30cf8.omft.near), adi USDC.e (nep141:adi-0x9cb8…71c2.omft.near)
```

Sample full row: `{"assetId":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","decimals":6,"blockchain":"base","symbol":"USDC","price":0.999459,"priceUpdatedAt":"2026-11-09T20:44:30.840Z","contractAddress":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"}`

### `deposit_address` (2026-11-09T20:46:56Z, `account_id: herald-test.near`)

```text
eth:137    {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:137"}}
eth:56     {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:56"}}
eth:43114  {"result":{"address":"0xa16d4873c23FF827b7aF33914b696199e3c35D23","chain":"eth:43114"}}
eth:10 / eth:143 / eth:196 / eth:534352 / eth:9745 / eth:8453 / eth:42161 / eth:1   same 0xa16d…5D23
sol:mainnet      {"result":{"address":"NPyGV1D3uo4M948otwPZ9E7Ax8VfuYm6A8KwF8uuTzs","chain":"sol:mainnet"}}
tron:mainnet     {"result":{"address":"TQgscX1qJMAMbtsgUedZ95otcEyzr8FoSy","chain":"tron:mainnet"}}
stellar:mainnet  {"error":"Deposit mode MEMO is required for this chain"}
```

### `supported_tokens` with `{"chains":["eth:137"]}`

```text
5 tokens: POL nep245:v2_1.omni.hot.tg:137_11111111111111111111 | USDC nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L |
          USDT nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr | COCA nep141:pol-0x7b12598e3616261df1c05ec28de0d2fb10c1f206.omdep.near |
          WETH nep245:v2_1.omni.hot.tg:137_2jwTGwKRX3AEe7tyzDrxtDjEFgSt
```

### NEAR `call_function` (finality final) on Omni stablecoin contracts

```text
pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near   ft_total_supply "31457042"        ft_metadata USDC 6
bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near   ft_total_supply "1000000000000"   ft_metadata USDC 18
avax-0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e.omdep.near  ft_total_supply "1"               ft_metadata USDC 6
bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near   ft_total_supply "0"
```

Content from all sources was paraphrased for compliance with licensing restrictions; direct quotes are under 30 words.
