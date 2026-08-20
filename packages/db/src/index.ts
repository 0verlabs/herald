import { schema as indexer } from "./lib/indexer";
import * as app from "./schemas/tables";

export const schema = { ...app, ...indexer };
