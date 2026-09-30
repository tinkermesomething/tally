CREATE TABLE `category_parent_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`parent_id` integer,
	`effective_year` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pay_period_anchors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`income_source_id` integer NOT NULL,
	`received_date` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `income_sources` ADD `is_pay_anchor` integer DEFAULT false NOT NULL;