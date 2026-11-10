import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema; it never connects to D1.
// Migrations are applied with `wrangler d1 migrations apply` from
// apps/facilitator, which reads them through `migrations_pattern`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
