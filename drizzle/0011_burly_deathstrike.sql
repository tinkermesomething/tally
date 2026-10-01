PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`field` text NOT NULL,
	`operator` text NOT NULL,
	`value` text NOT NULL,
	`target_type` text DEFAULT 'expense' NOT NULL,
	`category_id` integer,
	`income_source_id` integer,
	`debt_person_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`income_source_id`) REFERENCES `income_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_category_rules`("id", "field", "operator", "value", "category_id", "debt_person_id", "sort_order", "active") SELECT "id", "field", "operator", "value", "category_id", "debt_person_id", "sort_order", "active" FROM `category_rules`;--> statement-breakpoint
DROP TABLE `category_rules`;--> statement-breakpoint
ALTER TABLE `__new_category_rules` RENAME TO `category_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `imported_transactions` ADD `categorized_income_source_id` integer REFERENCES income_sources(id);