import { timestamp } from "drizzle-orm/pg-core";

export const timestamps = {
  created_at: timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updated_at: timestamp({ withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};
