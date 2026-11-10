import { drizzle } from "drizzle-orm/d1";

export * from "./schema.ts";

/**
 * Wraps a D1 binding in a Drizzle client. Query with the exported tables
 * (`db.select().from(providers)`). Drizzle 1.0 takes relations, not a schema
 * object; pass them here once tables reference each other.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1);
}

export type Db = ReturnType<typeof createDb>;
