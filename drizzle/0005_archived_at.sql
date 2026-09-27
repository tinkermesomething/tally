ALTER TABLE `categories` DROP COLUMN `archived`;--> statement-breakpoint
ALTER TABLE `categories` ADD `archived_at` integer;
