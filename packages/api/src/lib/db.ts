import type * as schema from "@hrld/db";
import type { NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";

export type Db<Schema extends Record<string, unknown> = typeof schema> = NodePgDatabase<Schema> & {
  $client: NodePgClient;
};
