ALTER TABLE `income_sources` DROP COLUMN `archived`;--> statement-breakpoint
ALTER TABLE `income_sources` ADD `archived_at` integer;
