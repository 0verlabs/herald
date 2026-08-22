import * as schema from "@hrld/indexer/schema";
import { setDatabaseSchema } from "@ponder/client";
import { drizzle } from "drizzle-orm/node-postgres";

import { env } from "../env";

setDatabaseSchema(schema, env.INDEXER_DATABASE_SCHEMA);

export const db = drizzle(env.DATABASE_URL, { schema });
