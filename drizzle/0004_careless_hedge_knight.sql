CREATE TABLE `report_panels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`selection` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
