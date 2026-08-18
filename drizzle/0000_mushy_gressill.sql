CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner` text NOT NULL,
	`collaborators` text DEFAULT '[]' NOT NULL,
	`recipients` text DEFAULT '[]' NOT NULL,
	`due` text NOT NULL,
	`source` text NOT NULL,
	`topic` text NOT NULL,
	`project` text NOT NULL,
	`recurring_meeting` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`created` text NOT NULL,
	`updates` text DEFAULT '[]' NOT NULL
);
