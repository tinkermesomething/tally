CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oidc_sub` text,
	`email` text NOT NULL,
	`name` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`disabled_at` integer,
	`dek_sealed` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_sub_unique` ON `users` (`oidc_sub`);