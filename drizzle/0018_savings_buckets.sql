CREATE TABLE `savings_buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`goal_pence` integer,
	`goal_date` text,
	`opening_pence` integer DEFAULT 0 NOT NULL,
	`note` text,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `savings_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket_id` integer NOT NULL,
	`entry_date` text NOT NULL,
	`amount_pence` integer NOT NULL,
	`direction` text NOT NULL,
	`note` text,
	`expense_entry_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `savings_buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_entry_id`) REFERENCES `expense_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `linked_bucket_id` integer REFERENCES savings_buckets(id);