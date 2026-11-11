-- Solana Sweeps. `sweeps` gains `source_kind` and the Solana columns, and
-- the EVM-only columns become nullable. SQLite can't relax NOT NULL in
-- place, so the table is rebuilt. Hand-edited from drizzle-kit's output:
-- drizzle-kit also emitted `ALTER TABLE ADD source_kind NOT NULL` without a
-- default, which SQLite refuses, and every existing row is an EVM Sweep.
-- Nothing references `sweeps`, so dropping it needs no foreign key pragma
-- (D1 doesn't honour `PRAGMA foreign_keys=OFF` in a migration anyway).
CREATE TABLE `__new_sweeps` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`provider_id` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_network` text NOT NULL,
	`asset` text NOT NULL,
	`amount` text NOT NULL,
	`destination_kind` text NOT NULL,
	`destination_network` text NOT NULL,
	`destination_address` text NOT NULL,
	`authorization_nonce` text,
	`valid_after` integer,
	`valid_before` integer NOT NULL,
	`payload_hash` text,
	`solana_transaction` text,
	`last_valid_block_height` integer,
	`near_tx_hash` text UNIQUE,
	`source_tx_hash` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	CONSTRAINT `fk_sweeps_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_sweeps`(`id`, `provider_id`, `source_kind`, `source_network`, `asset`, `amount`, `destination_kind`, `destination_network`, `destination_address`, `authorization_nonce`, `valid_after`, `valid_before`, `payload_hash`, `near_tx_hash`, `source_tx_hash`, `status`, `error`, `created_at`, `updated_at`, `submitted_at`) SELECT `id`, `provider_id`, 'evm', `source_network`, `asset`, `amount`, `destination_kind`, `destination_network`, `destination_address`, `authorization_nonce`, `valid_after`, `valid_before`, `payload_hash`, `near_tx_hash`, `source_tx_hash`, `status`, `error`, `created_at`, `updated_at`, `submitted_at` FROM `sweeps`;--> statement-breakpoint
DROP TABLE `sweeps`;--> statement-breakpoint
ALTER TABLE `__new_sweeps` RENAME TO `sweeps`;--> statement-breakpoint
CREATE INDEX `sweeps_provider_created` ON `sweeps` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sweeps_provider_submitted` ON `sweeps` (`provider_id`,`submitted_at`);
