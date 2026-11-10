CREATE TABLE `sweep_minimums` (
	`network` text NOT NULL,
	`asset` text NOT NULL,
	`minimum` text NOT NULL,
	`note` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `sweep_minimums_pk` PRIMARY KEY(`network`, `asset`)
);
--> statement-breakpoint
CREATE TABLE `sweeps` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`provider_id` integer NOT NULL,
	`source_network` text NOT NULL,
	`asset` text NOT NULL,
	`amount` text NOT NULL,
	`destination_kind` text NOT NULL,
	`destination_network` text NOT NULL,
	`destination_address` text NOT NULL,
	`authorization_nonce` text NOT NULL,
	`valid_after` integer NOT NULL,
	`valid_before` integer NOT NULL,
	`payload_hash` text NOT NULL,
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
CREATE INDEX `sweeps_provider_created` ON `sweeps` (`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sweeps_provider_submitted` ON `sweeps` (`provider_id`,`submitted_at`);