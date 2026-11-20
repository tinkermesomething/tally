ALTER TABLE `app_settings` ADD `tour_seen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `show_help_icons` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `app_settings` SET `tour_seen` = 1;
