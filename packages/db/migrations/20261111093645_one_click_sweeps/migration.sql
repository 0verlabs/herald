ALTER TABLE `sweeps` ADD `destination_asset` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `one_click_quote_id` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `one_click_deposit_address` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `one_click_signature` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `quote_amount_out` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `quote_min_amount_out` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `quote_refund_fee` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `quote_time_estimate` integer;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `quote_deadline` integer;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `delivered_amount` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `refunded_amount` text;--> statement-breakpoint
ALTER TABLE `sweeps` ADD `delivery_tx_hash` text;