CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`provider_id` integer NOT NULL,
	`env` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL UNIQUE,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	CONSTRAINT `fk_api_keys_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`provider_id` integer NOT NULL,
	`api_key_id` integer NOT NULL,
	`network` text NOT NULL,
	`asset` text NOT NULL,
	`amount` text NOT NULL,
	`buyer_address` text NOT NULL,
	`tx_hash` text NOT NULL,
	`resource_url` text,
	`settled_at` integer NOT NULL,
	CONSTRAINT `fk_payments_provider_id_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`),
	CONSTRAINT `fk_payments_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_network_tx_hash_unique` ON `payments` (`network`,`tx_hash`);