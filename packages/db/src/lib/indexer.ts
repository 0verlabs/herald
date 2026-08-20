import * as schema from "@hrld/indexer/schema";
import { setDatabaseSchema } from "@ponder/client";

setDatabaseSchema(schema, "indexer");

export { schema };
