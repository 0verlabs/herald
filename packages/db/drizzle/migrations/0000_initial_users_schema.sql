CREATE TABLE `user_wallets` (
	`clerk_user_id` text PRIMARY KEY NOT NULL,
	`circle_wallet_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_wallets_circle_wallet_id_unique` ON `user_wallets` (`circle_wallet_id`);