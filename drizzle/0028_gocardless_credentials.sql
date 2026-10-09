CREATE TABLE `gocardless_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`secret_id` text NOT NULL,
	`secret_key` text NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
