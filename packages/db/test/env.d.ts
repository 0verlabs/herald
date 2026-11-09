declare namespace Cloudflare {
  interface Env {
    /** Set in vite.config.ts from `readMigrations()`. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
