declare namespace Cloudflare {
  interface Env {
    /** Set in vite.workers.config.ts from `readMigrations()`. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
