CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`can_invite` integer DEFAULT false NOT NULL,
	`projects` text DEFAULT '[]' NOT NULL,
	`meetings` text DEFAULT '[]' NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`invite_token_hash` text,
	`invited_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);