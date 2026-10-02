ALTER TABLE `debt_ledger_entries` ADD `expense_entry_id` integer REFERENCES expense_entries(id);--> statement-breakpoint
ALTER TABLE `expense_entries` ADD `provisional` integer DEFAULT false NOT NULL;