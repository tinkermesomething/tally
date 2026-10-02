ALTER TABLE `app_settings` ADD `bank_sync_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `bank_sync_frequency_hours` integer DEFAULT 24 NOT NULL;