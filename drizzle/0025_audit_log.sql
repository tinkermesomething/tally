CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (current_timestamp) NOT NULL,
	`action` text NOT NULL,
	`detail` text,
	`ip` text
);
