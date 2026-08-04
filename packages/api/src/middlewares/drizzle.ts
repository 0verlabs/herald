import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";

import type { Db } from "../lib/db";

export interface DrizzleDbVariables<Schema extends Record<string, unknown>> {
  db: Db<Schema>;
}

export const drizzleDb = <Schema extends Record<string, unknown>>(schema: Schema) =>
  createMiddleware<{ Bindings: Env; Variables: DrizzleDbVariables<Schema> }>((c, next) => {
    const drizzleDb = drizzle(c.env.DB, { schema });

    c.set("db", drizzleDb);

    return next();
  });
