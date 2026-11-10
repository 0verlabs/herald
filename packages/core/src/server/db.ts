import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * Herald's database: a Drizzle client over D1, as `createDb()` from
 * `@herald/db` returns it. Core's business functions take it as an argument.
 */
export type Db = DrizzleD1Database;
