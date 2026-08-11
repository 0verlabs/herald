import type * as schema from "@0verlabs/herald-db";

import type { DrizzleDbVariables } from "./middlewares/drizzle";

export type GlobalVariables = DrizzleDbVariables<typeof schema>;
