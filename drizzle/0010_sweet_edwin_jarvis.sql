CREATE TABLE `email_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`queue` text NOT NULL,
	`user_id` text,
	`order_id` integer,
	`replay_of_id` text,
	`sequence` integer,
	`template_version` integer DEFAULT 1 NOT NULL,
	`payload_ciphertext` text,
	`payload_iv` text,
	`payload_tag` text,
	`payload_key_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`next_attempt_at` integer NOT NULL,
	`enqueued_at` integer,
	`submitted_at` integer,
	`terminal_at` integer,
	`lease_until` integer,
	`lease_token` text,
	`dispatch_attempts` integer DEFAULT 0 NOT NULL,
	`send_attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`provider_message_id` text,
	CONSTRAINT "email_notifications_queue" CHECK("email_notifications"."queue" IN ('AUTH','ORDER')),
	CONSTRAINT "email_notifications_status" CHECK("email_notifications"."status" IN ('PENDING','ENQUEUED','SENDING','SUBMITTED','EXPIRED','SKIPPED','FAILED','UNCERTAIN')),
	CONSTRAINT "email_notifications_attempts" CHECK("email_notifications"."send_attempts" >= 0 AND "email_notifications"."dispatch_attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_notifications_dedupe` ON `email_notifications` (`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_notifications_order_sequence` ON `email_notifications` (`order_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `email_notifications_due` ON `email_notifications` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `email_notifications_retention` ON `email_notifications` (`terminal_at`);