-- The NEAR Receiving Address (ADR-0009): the implicit account of the MPC
-- ed25519 key derived on path `near-1`, 64 lowercase hex characters.
-- Registration stores it. Existing rows can't be backfilled in SQL, which has
-- no sha3-256 or ed25519 point arithmetic, so the column is nullable and
-- @herald/core derives and stores it the first time it reads a row without
-- one (`providerFromRow`: sign-in, an API key's first use, any dashboard
-- read). Nothing outside core reads the raw column.
ALTER TABLE `providers` ADD `near_address` text;
