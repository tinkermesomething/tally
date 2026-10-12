CREATE TABLE `household_category_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_user_id` integer NOT NULL,
	`source_category_id` integer NOT NULL,
	`category_name` text NOT NULL,
	`group_name` text,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
