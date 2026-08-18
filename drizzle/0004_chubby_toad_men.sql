CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_normalized_name_unique` ON `companies` (`normalized_name`);--> statement-breakpoint
ALTER TABLE `users` ADD `company_id` integer REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;