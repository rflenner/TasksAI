CREATE TABLE `dimension_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dimension_values_type_value_unique` ON `dimension_values` (`type`,`value`);