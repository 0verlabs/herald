import { readD1Migrations } from "@cloudflare/vitest-plugin";

/**
 * Reads Herald's D1 migrations for the Cloudflare Vitest pool. Runs in Node.js
 * from a `vite.config.ts`. Pass the result to the pool as a binding, then
 * apply it in a setup file with `applyD1Migrations()` from `cloudflare:test`.
 */
export function readMigrations() {
  return readD1Migrations({
    projectPath: import.meta.dirname,
    migrationsDir: "migrations",
    migrationsPattern: "migrations/*/migration.sql",
  });
}
