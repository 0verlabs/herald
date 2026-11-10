# Drizzle 1.0 release candidate, not 0.45 stable

`packages/db` uses `drizzle-orm` and `drizzle-kit` at `1.0.0-rc.5`, pinned exactly in the pnpm catalog. Drizzle's D1 guide now installs the `rc` tag, the RC ships Zod schemas built in (`drizzle-orm/zod`) instead of the separate `drizzle-zod` package last published in August 2025, and its per-migration folders (`migrations/<timestamp>_<name>/migration.sql`) are read by both `wrangler d1 migrations apply` and `readD1Migrations()` in the Cloudflare Vitest pool through `migrations_pattern`. Zod schemas in `packages/core` stay the source of truth; Drizzle tables are kept in line with them, and the db tests parse rows read back from D1 with the core schema.

## Considered Options

- **0.45 stable with `drizzle-zod`**: rejected. It would work, but it moves Herald onto the line Drizzle is replacing, with an older Zod bridge, a few days before the 1.0 migration would be needed anyway.

## Consequences

- RC APIs can still change. Version bumps are deliberate edits to the catalog pin, not range updates.
- The 1.0 client takes `relations` instead of a `schema` object, so relational queries need `defineRelations()` once tables reference each other.
- New migrations come from `drizzle-kit generate` (`vp run db:generate`). `wrangler d1 migrations create` writes flat files, which the pattern does not match.
