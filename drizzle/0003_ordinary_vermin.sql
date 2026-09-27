ALTER TABLE `categories` ADD `due_day` integer;--> statement-breakpoint
ALTER TABLE `expense_entries` ADD `debt_person_id` integer REFERENCES people(id);