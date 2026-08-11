# Herald monorepo

Bun + Turborepo monorepo for Herald (agentic commerce on 0G Testnet). Root package is
`herald`; workspaces live in `packages/*` and are named
`@0verlabs/herald-<name>` (currently: `api`, `chat`, `db`, `indexer`, `ui`).

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
  Tailwind, TanStack Router, Hono, Drizzle, Zod, TypeScript, etc. are
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
- Stack choices for now: Hono for APIs, Drizzle for DB (Postgres), Zod for
  validation, React + Vite + TailwindCSS + TanStack Router (file routing) for
  frontend.

## New package checklist

1. `packages/<name>`, name `@0verlabs/herald-<name>`, `"private": true`.
2. tsconfig follows the existing packages setup (`strict`,
   `"moduleResolution": "Bundler"`, `noEmit`).
3. Scripts contract for Turbo: `build`, `dev`, `check` (runs `check:lint` +
   `check:types`), `check:lint` (`biome check .` — format + lint + imports),
   `check:types` (`tsc --noEmit`), `check:staged`
   (`biome check . --write --staged …`, run by the pre-commit hook).
4. Depend on sibling packages with `bun add @0verlabs/herald-<name>`
   (workspace protocol).

## Repository layout

```
.
├── packages/          # All workspaces live here (@0verlabs/herald-<name>)
├── turbo.json         # Task pipeline
├── tsconfig.json      # Root TS config (extends @tsconfig/bun)
├── biome.jsonc        # Lint + format rules (repo-wide)
├── bunfig.toml        # install.exact = true — versions are always pinned
├── docker-compose.yaml# Local databases
├── .agents/skills/    # Agent skills (shadcn, Vercel guidelines, …)
└── .github/workflows  # CI, Changesets release
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
