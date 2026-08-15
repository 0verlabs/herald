import { drizzle } from "drizzle-orm/node-postgres";
import { createMiddleware } from "hono/factory";

import type { Db } from "../lib/db";

export interface DrizzleDbVariables<Schema extends Record<string, unknown>> {
  db: Db<Schema>;
}

export const drizzleDb = <Schema extends Record<string, unknown>>(
  databaseUrl: string,
  schema: Schema
) =>
  createMiddleware<{ Variables: DrizzleDbVariables<Schema> }>((c, next) => {
    const drizzleDb = drizzle(databaseUrl, { schema });

    c.set("db", drizzleDb);

    return next();
  });
