CREATE TABLE `activity_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`actor_role` text,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_name` text NOT NULL,
	`changes_json` text NOT NULL,
	`stock_delta` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_newest_idx` ON `activity_events` (`id`);--> statement-breakpoint
CREATE INDEX `activity_target_idx` ON `activity_events` (`target_type`,`target_id`,`id`);--> statement-breakpoint
CREATE INDEX `activity_actor_idx` ON `activity_events` (`actor_user_id`,`id`);