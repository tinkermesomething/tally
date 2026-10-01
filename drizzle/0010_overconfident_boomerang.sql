CREATE TABLE `bank_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`institution_id` text NOT NULL,
	`requisition_id` text NOT NULL,
	`external_account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`consent_expires_at` integer NOT NULL,
	`last_synced_at` integer,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`field` text NOT NULL,
	`operator` text NOT NULL,
	`value` text NOT NULL,
	`category_id` integer NOT NULL,
	`debt_person_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `imported_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bank_account_id` integer NOT NULL,
	`imported_id` text NOT NULL,
	`amount_pence` integer NOT NULL,
	`booking_date` text NOT NULL,
	`payee_raw` text NOT NULL,
	`payee_clean` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`possible_duplicate_expense_entry_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `imported_transactions_dedup` ON `imported_transactions` (`bank_account_id`,`imported_id`);--> statement-breakpoint
ALTER TABLE `expense_entries` ADD `imported_transaction_id` integer REFERENCES imported_transactions(id);