-- Run once per environment (local dev + Railway) BEFORE starting Ponder.
-- Required by the gin_trgm_ops indexes defined in ponder.schema.ts.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
