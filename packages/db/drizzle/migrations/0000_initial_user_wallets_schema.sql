CREATE TABLE `user_wallets` (
	`user_id` text NOT NULL,
	`network` text NOT NULL,
	`wallet_address` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `network`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_wallets_wallet_address_unique` ON `user_wallets` (`wallet_address`);