import type { NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@0verlabs/herald-db";

export type Db<Schema extends Record<string, unknown> = typeof schema> = NodePgDatabase<Schema> & {
  $client: NodePgClient;
};
