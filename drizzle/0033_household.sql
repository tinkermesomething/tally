ALTER TABLE `categories` ADD `shared_to_household` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `expense_entries` ADD `shared_to_household` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `income_sources` ADD `shared_to_household` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `household_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`enabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `household_expense_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_user_id` integer NOT NULL,
	`source_expense_entry_id` integer NOT NULL,
	`category_name` text NOT NULL,
	`amount_pence` integer NOT NULL,
	`entry_date` text NOT NULL,
	`note` text,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `household_income_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_user_id` integer NOT NULL,
	`source_income_source_id` integer NOT NULL,
	`source_name` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
