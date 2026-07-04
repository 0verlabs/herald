# ivanius.ai monorepo

Bun + Turborepo monorepo for the Cloudflare ecosystem (Workers, D1, KV, Durable
Objects). Root package is `ivanius.ai`; workspaces live in `packages/*` and are
named `@ivanius.ai/<name>`.

## Commands

- `bun run build | dev | lint | format | typecheck` — run via Turbo across packages
- `bun run check` / `bun run check:fix` — Biome on the whole repo
- `bun run changeset` — add a changeset (required for versioned changes)
- Filter to one package: `bun run build --filter=@ivanius.ai/<name>`

## Hard rules

- **Shared stack deps come from the catalog.** Versions for React, Vite,
  Tailwind, React Router, Hono, Drizzle, Wrangler, Zod, TypeScript, etc. are
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
  hono@latest`, `bun create react-router@latest`).
- Stack choices are fixed: Hono for APIs, Drizzle for DB (D1), Zod for
  validation, React + Vite + TailwindCSS + React Router (file routing) for
  frontend, Wrangler for all Cloudflare infra.

## New package checklist

1. `packages/<name>`, name `@ivanius.ai/<name>`, `"private": true`.
2. tsconfig extends `../../tsconfig.base.json`; add `reset.d.ts` with
   `import "@total-typescript/ts-reset";` and include it.
3. Scripts contract for Turbo: `build`, `dev`, `typecheck`, `lint` (`biome lint .`),
   `format` (`biome format --write .`); Cloudflare packages also add
   `deploy` (`wrangler deploy`) — CI deploys `main` via `turbo run deploy`.
4. Worker packages: types come from `wrangler types` (NOT
   `@cloudflare/workers-types` — only pure libraries without a wrangler config
   use that). Set `"typecheck": "wrangler types && tsc --noEmit"`, tsconfig
   `"types": ["./worker-configuration.d.ts"]`, and commit the generated
   `worker-configuration.d.ts`. Re-run `wrangler types` after changing
   wrangler config/bindings.

## UI: Astryx design system

UI code uses Meta's Astryx (https://astryx.atmeta.com) on Tailwind. Before
writing UI, follow its AI workflow **in order**:

1. `bunx astryx template --list` — find related page patterns
2. `bunx astryx template <name> --skeleton` — study layout structure
3. `bunx astryx component <Name>` — read props and examples

Astryx also exposes an MCP server at `https://astryx.atmeta.com/mcp` (name it
`xds`). Initialize per package with `bunx astryx init --features agents --agent claude`.
