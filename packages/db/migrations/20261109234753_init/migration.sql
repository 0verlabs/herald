CREATE TABLE `providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`account_id` text NOT NULL UNIQUE,
	`evm_address` text NOT NULL,
	`solana_address` text NOT NULL,
	`created_at` integer NOT NULL
);
