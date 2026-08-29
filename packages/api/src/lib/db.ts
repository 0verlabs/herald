import type * as schema from "@hrld/db";
import type { AnyColumn, SQL } from "drizzle-orm";
import type { NodePgClient, NodePgDatabase } from "drizzle-orm/node-postgres";
import { desc, or, sql } from "drizzle-orm";

export type Db<Schema extends Record<string, unknown> = typeof schema> = NodePgDatabase<Schema> & {
  $client: NodePgClient;
};

export const DEFAULT_TRIGRAM_SIMILARITY_THRESHOLD = 0.15;

export const buildTextSearch = (
  columns: (AnyColumn | SQL)[],
  q: string,
  threshold = DEFAULT_TRIGRAM_SIMILARITY_THRESHOLD
) => {
  const pattern = `%${q}%`;
  const match = or(
    ...columns.flatMap((column) => [
      sql`${column} ilike ${pattern}`,
      sql`similarity(${column}, ${q}) > ${threshold}`,
    ])
  ) as SQL;
  const relevance = desc(
    sql`greatest(${sql.join(
      columns.map((column) => sql`similarity(${column}, ${q})`),
      sql`, `
    )})`
  );

  return { match, relevance };
};
