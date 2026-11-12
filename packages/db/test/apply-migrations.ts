import { env } from "cloudflare:workers";
import { applyMigrations } from "../src/apply-migrations.ts";

// Not applyD1Migrations() from cloudflare:test: a setup file importing
// cloudflare:test makes workerd exit before the next test file on the same
// pool worker (see applyMigrations). Setup files run once per test file;
// applied migrations are skipped.
await applyMigrations(env.DB, env.TEST_MIGRATIONS);
