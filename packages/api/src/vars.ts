import type * as schema from "@hrld/db";

import type { DrizzleDbVariables } from "./middlewares/drizzle";

export type GlobalVariables = DrizzleDbVariables<typeof schema>;
