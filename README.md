<div align="center">
  <img width="120x" height="auto" src="assets/logo.png" />
</div>

# Ivanius

Bun + Turborepo monorepo targeting the Cloudflare ecosystem. All workspace
packages are named `@ivanius.ai/<name>`.

## Stack

| Concern        | Tool                                                          |
| -------------- | ------------------------------------------------------------- |
| Runtime & PM   | [Bun](https://bun.com)                                        |
| Orchestration  | [Turborepo](https://turborepo.com)                            |
| Language       | TypeScript (strict) + [ts-reset](https://github.com/mattpocock/ts-reset) |
| Frontend       | React + Vite, TailwindCSS + [shadcn/ui](https://ui.shadcn.com), [TanStack Router](https://tanstack.com/router) (file routing) |
| Backend        | [Hono](https://hono.dev)                                      |
| Database       | [Drizzle ORM](https://orm.drizzle.team) (Cloudflare D1)       |
| Validation     | [Zod](https://zod.dev)                                        |
| Infrastructure | [Wrangler](https://developers.cloudflare.com/workers/wrangler/) — D1, KV, Durable Objects, Workers |
| Lint & format  | [Biome](https://biomejs.dev)                                  |
| Git hooks      | [Husky](https://typicode.github.io/husky/)                    |
| Versioning     | [Changesets](https://github.com/changesets/changesets)        |
| CI/CD          | GitHub Actions → Cloudflare                                   |

## Getting started

```sh
bun install
bun run dev
```

## Scripts

All package-level tasks run through Turborepo:

| Script                     | What it does                                            |
| -------------------------- | -------------------------------------------------------- |
| `bun run build`            | `turbo run build` across all packages                    |
| `bun run dev`              | `turbo run dev` (persistent, uncached)                    |
| `bun run lint`             | `turbo run lint` across all packages                      |
| `bun run lint:staged`      | `turbo run lint:staged` — staged files only, run by the pre-commit hook |
| `bun run format`           | `turbo run format` across all packages                    |
| `bun run typecheck`        | `turbo run typecheck` across all packages                 |
| `bun run changeset`        | Create a changeset                                        |
| `bun run version-packages` | `changeset version` — apply pending changesets and bump versions |

## Structure

```
.
├── packages/          # All workspaces live here (@ivanius.ai/<name>)
├── turbo.json         # Task pipeline
├── tsconfig.base.json # Shared TS config — every package extends this
├── biome.json         # Lint + format rules (repo-wide)
├── bunfig.toml        # install.exact = true — versions are always pinned
└── .github/workflows  # CI, Cloudflare deploy, Changesets release
```

## Adding a package

Packages are named `@ivanius.ai/<name>` and live in `packages/<name>`. Prefer
`bun create` scaffolding, then align the package with the repo conventions below.

```sh
# Frontend (React + Vite + Tailwind on Cloudflare Workers, file routing via TanStack Router)
bunx create-tsrouter-app@latest packages/<name> --template file-router --package-manager bun

# API (Hono on Cloudflare Workers — pick the cloudflare-workers template)
bun create hono@latest packages/api

# Plain library (utils, core, db, cli, …)
mkdir packages/<name> && cd packages/<name> && bun init -y
```

Every package must:

1. Be named `@ivanius.ai/<name>`, `"private": true` unless it is published.
2. Extend the root TS config: `"extends": "../../tsconfig.base.json"`.
3. Add a `reset.d.ts` containing `import "@total-typescript/ts-reset";` and include it in its tsconfig.
4. Define the task contract so Turbo can run it:
   - `build`, `dev`, `typecheck` (`tsc --noEmit`)
   - `lint` (`biome lint .`), `format` (`biome format --write .`)
   - `deploy` (`wrangler deploy`) for anything that ships to Cloudflare

   Worker packages generate their runtime + `Env` types with
   [`wrangler types`](https://developers.cloudflare.com/workers/languages/typescript/)
   instead of depending on `@cloudflare/workers-types`:
   - `"typecheck": "wrangler types && tsc --noEmit"`
   - tsconfig: `"types": ["./worker-configuration.d.ts"]`
   - Commit `worker-configuration.d.ts`; CI can verify it with `wrangler types --check`.
   - (`@cloudflare/workers-types` is only for pure library packages that need
     workers-environment types but have no wrangler config of their own.)
5. Reference shared stack dependencies through the catalog: `"react": "catalog:"`.
6. Add non-catalog dependencies with `bun add` (never hand-write versions) — `bunfig.toml` pins exact versions automatically.
7. Depend on sibling packages with `bun add @ivanius.ai/<name>` (workspace protocol).

### Dependency catalog

Shared libraries/frameworks (React, Vite, Tailwind, TanStack Router, Hono, Drizzle,
Wrangler, Zod, TypeScript, …) are version-pinned once in the root
`package.json` under `workspaces.catalog`. Packages reference them without a
version:

```jsonc
// packages/web/package.json
"dependencies": {
  "react": "catalog:",
  "zod": "catalog:"
}
```

> **Note:** `bun add react` writes a pinned version and does **not** use the
> catalog. For cataloged dependencies, write `"<pkg>": "catalog:"` in the
> package's `package.json` and run `bun install`. To upgrade a shared
> dependency, bump its version once in the root catalog.

### UI work (shadcn)

The `ui` package holds shared components, built with [shadcn/ui](https://ui.shadcn.com)
on top of Tailwind (`components.json` lives there). Frontend packages import
components from it: `@ivanius.ai/ui/components/<name>`.

Add or update components from inside `packages/ui`:

```sh
bunx shadcn add <component>
```

A Claude Code skill (`shadcn`) is installed at the repo root — invoke it when
adding, styling, or composing shadcn components instead of hand-rolling them.

## Deployment & releases

- **CI** (`ci.yml`) — Biome, lint, typecheck, build on every PR and push to `main`.
- **Deploy** (`deploy.yml`) — on push to `main`, runs `turbo run deploy` (each
  Cloudflare package's `wrangler deploy`). Requires the `CLOUDFLARE_API_TOKEN`
  and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **Release** (`release.yml`) — Changesets opens a "Version Packages" PR. Add a
  changeset to your PRs with `bun run changeset`.

Git hooks: pre-commit runs Biome on staged files (auto-installed via `bun install`).
