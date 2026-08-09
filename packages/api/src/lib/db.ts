import type { NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@ivanius.ai/db";

export type Db<Schema extends Record<string, unknown> = typeof schema> = NodePgDatabase<Schema> & {
  $client: NodePgClient;
};
