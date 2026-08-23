import type { NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as appSchema from "@hrld/db";
import * as indexerSchema from "@hrld/indexer/schema";

export const schema = { ...appSchema, ...indexerSchema };

export type Db<Schema extends Record<string, unknown> = typeof schema> = NodePgDatabase<Schema> & {
  $client: NodePgClient;
};
