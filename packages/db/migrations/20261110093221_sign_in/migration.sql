CREATE TABLE `sign_in_nonces` (
	`nonce` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
