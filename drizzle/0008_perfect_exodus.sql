CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`date_format` text DEFAULT 'dmy' NOT NULL
);
