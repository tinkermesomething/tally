CREATE TABLE `income_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`income_source_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`amount_pence` integer NOT NULL,
	`note` text,
	`entry_date` text NOT NULL,
	`debt_person_id` integer,
	`imported_transaction_id` integer,
	`provisional` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_transaction_id`) REFERENCES `imported_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `debt_ledger_entries` ADD `income_transaction_id` integer REFERENCES income_transactions(id);
--> statement-breakpoint
ALTER TABLE `imported_transactions` ADD `possible_duplicate_income_transaction_id` integer;
--> statement-breakpoint
ALTER TABLE `imported_transactions` DROP COLUMN `categorized_income_source_id`;
