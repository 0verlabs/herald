import type { DrizzleD1Database } from "drizzle-orm/d1";

import type * as schema from "@ivanius.ai/db";

export type Db<Schema extends Record<string, unknown> = typeof schema> =
  DrizzleD1Database<Schema> & {
    $client: D1Database;
  };
