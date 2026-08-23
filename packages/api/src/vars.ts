import type { schema } from "./lib/db";
import type { DrizzleDbVariables } from "./middlewares/drizzle";

export type GlobalVariables = DrizzleDbVariables<typeof schema>;
