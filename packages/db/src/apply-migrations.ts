import type { D1Migration } from "cloudflare:test";

/**
 * Applies the migrations `readMigrations()` read to a test D1 database, from
 * a Vitest setup file in the Cloudflare pool, skipping those already applied
 * (setup files run once per test file). It does what `applyD1Migrations()`
 * from `cloudflare:test` does, with the same `d1_migrations` table.
 *
 * Setup files must not import `cloudflare:test`: under Vitest 5 that makes
 * workerd exit when the pool worker starts its next test file, and every
 * later file on that worker silently doesn't run (workers-sdk #16331).
 * Test files can import it.
 */
export async function applyMigrations(db: D1Database, migrations: D1Migration[]): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    )
    .run();
  const applied = new Set(
    (await db.prepare("SELECT name FROM d1_migrations").all<{ name: string }>()).results.map(
      ({ name }) => name,
    ),
  );
  const record = db.prepare("INSERT INTO d1_migrations (name) VALUES (?)");
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.batch([
      ...migration.queries.map((query) => db.prepare(query)),
      record.bind(migration.name),
    ]);
  }
}
