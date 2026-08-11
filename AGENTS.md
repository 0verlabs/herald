# Herald monorepo

Bun + Turborepo monorepo for the Cloudflare ecosystem (Workers, D1, KV, Durable
Objects). Root package is `herald`; workspaces live in `packages/*` and are
named `@0verlabs/herald-<name>` (currently: `api`, `chat`, `db`, `indexer`, `ui`).

Note: the stack is expected to change significantly during early development;
don't treat current tooling choices as long-term commitments.

## Commands

- `bun install` — install (also installs Husky git hooks via `prepare`)
- `bun run build | dev | check` — run via Turbo across packages (`check` runs
  `check:lint` (Biome) + `check:types` (tsc); both also runnable standalone)
- `bun run check:staged` — Turbo `biome check --write` of staged files only; run by the pre-commit hook
- `bun run changeset` — add a changeset (required for versioned changes)
- `bun run version-packages` — apply pending changesets and bump versions
- Filter to one package: `bun run build --filter=@0verlabs/herald-<name>`
- Local Postgres databases run via `docker compose up -d` (see `docker-compose.yaml`);
  copy each package's `.env.example` to `.env` before first run.

## Hard rules

- **Shared stack deps come from the catalog.** Versions for React, Vite,
  Tailwind, TanStack Router, Hono, Drizzle, Wrangler, Zod, TypeScript, etc. are
  pinned once in root `package.json` → `workspaces.catalog`. In packages,
  reference them as `"react": "catalog:"` and run `bun install`. `bun add`
  does NOT write `catalog:` references — this is the one case where you edit
  package.json by hand. New shared deps get an exact version added to the
  catalog first.
- **Never hand-write dependency versions in package.json.** For anything not in
  the catalog, use `bun add <pkg>` / `bun add -d <pkg>` in the target package.
  `bunfig.toml` enforces exact versions.
- **Bun everywhere**: `bun`/`bunx`, never `npm`/`npx`/`node`. Scaffold new
  packages with `bun create <template>` when one exists (e.g. `bun create
  hono@latest`, `bunx create-tsrouter-app@latest`).
- Stack choices for now: Hono for APIs, Drizzle for DB (D1), Zod for
  validation, React + Vite + TailwindCSS + TanStack Router (file routing) for
  frontend, Wrangler for all Cloudflare infra.

## New package checklist

1. `packages/<name>`, name `@0verlabs/herald-<name>`, `"private": true`.
2. tsconfig extends `../../tsconfig.base.json`; add `reset.d.ts` with
   `import "@total-typescript/ts-reset";` and include it.
3. Scripts contract for Turbo: `build`, `dev`, `check` (runs `check:lint` +
   `check:types`), `check:lint` (`biome check .` — format + lint + imports),
   `check:types` (`tsc --noEmit`), `check:staged`
   (`biome check . --write --staged …`, run by the pre-commit hook); Cloudflare
   packages also add `deploy` (`wrangler deploy`) — CI deploys `main` via
   `turbo run deploy`.
4. Worker packages: types come from `wrangler types` (NOT
   `@cloudflare/workers-types` — only pure libraries without a wrangler config
   use that). Set `"check:types": "wrangler types && tsc --noEmit"`, tsconfig
   `"types": ["./worker-configuration.d.ts"]`, and commit the generated
   `worker-configuration.d.ts`. Re-run `wrangler types` after changing
   wrangler config/bindings.
5. Depend on sibling packages with `bun add @0verlabs/herald-<name>`
   (workspace protocol).

## Repository layout

```
.
├── packages/          # All workspaces live here (@0verlabs/herald-<name>)
├── turbo.json         # Task pipeline
├── tsconfig.base.json # Shared TS config — every package extends this
├── biome.jsonc        # Lint + format rules (repo-wide)
├── bunfig.toml        # install.exact = true — versions are always pinned
├── docker-compose.yaml# Local databases
├── .agents/skills/    # Agent skills (shadcn, Vercel guidelines, …)
└── .github/workflows  # CI, Cloudflare deploy, Changesets release
```

## UI: shadcn/ui

UI code uses shadcn/ui (https://ui.shadcn.com) on Tailwind. Shared components
live in `packages/ui` (see its `components.json`); frontend packages import
them via `@0verlabs/herald-ui/components/<name>`. Add or update a component
from inside `packages/ui`:

```sh
bunx shadcn add <component>
```

Use the `shadcn` skill (`.agents/skills/shadcn`, symlinked into
`.claude/skills/`) when adding, styling, or composing components instead of
hand-rolling them.
