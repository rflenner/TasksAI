ALTER TABLE `users` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `users` ADD `invite_channel` text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `invite_expires_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `accepted_at` text;