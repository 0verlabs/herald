import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/index.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
