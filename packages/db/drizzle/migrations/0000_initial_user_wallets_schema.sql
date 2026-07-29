CREATE TABLE `user_wallets` (
	`user_id` text NOT NULL,
	`network` text NOT NULL,
	`circle_wallet_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `network`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_wallets_circle_wallet_id_unique` ON `user_wallets` (`circle_wallet_id`);
