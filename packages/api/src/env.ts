import type * as schema from "@ivanius.ai/db";

import type { DrizzleDbVariables } from "./middlewares/drizzle";

export type GlobalVariables = DrizzleDbVariables<typeof schema>;
