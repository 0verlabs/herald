import { drizzle } from "drizzle-orm/d1";

import * as schema from "@ivanius.ai/db";

export function createDb(db: D1Database) {
  return drizzle(db, { schema });
}
