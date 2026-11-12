-- NEAR Sweeps (spec #30, #37): `source_kind` gains `near`, which needs no
-- change here (the enum is TypeScript-only, with no CHECK constraint). A NEAR
-- Sweep stores its unsigned NEP-366 delegate action (base64 Borsh), its nonce
-- and its `max_block_height`; its NEP-461 hash goes in `payload_hash`.
ALTER TABLE `sweeps` ADD `near_delegate_action` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `near_nonce` integer;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `near_max_block_height` integer;--> statement-breakpoint
-- Sweep minimums for USDC on NEAR: Herald's floor of 0.001 USDC on both
-- networks. 1Click's own minimum deposit for NEAR USDC is 0.000001 (spec #30).
-- The mainnet row is inert until NEAR mainnet is listed.
INSERT INTO `sweep_minimums` (`network`, `asset`, `minimum`, `note`, `updated_at`) VALUES
  ('near:testnet', '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af', '1000', 'Herald floor: 0.001 USDC. 1Click minimum deposit for NEAR USDC is 0.000001 (spec #30).', 1794487452000),
  ('near:mainnet', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', '1000', 'Herald floor: 0.001 USDC. 1Click minimum deposit for NEAR USDC is 0.000001 (spec #30).', 1794487452000);
