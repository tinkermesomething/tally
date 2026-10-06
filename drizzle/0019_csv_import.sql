ALTER TABLE `bank_accounts` ADD `csv_mapping` text;--> statement-breakpoint
ALTER TABLE `imported_transactions` ADD `possible_duplicate_imported_id` integer;