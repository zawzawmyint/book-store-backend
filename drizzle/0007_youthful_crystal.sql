CREATE TABLE `checkout_requests` (
	`user_id` text NOT NULL,
	`request_key` text NOT NULL,
	`lines_json` text NOT NULL,
	`order_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_requests_owner_key` ON `checkout_requests` (`user_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_requests_order` ON `checkout_requests` (`order_id`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`safe_error` text
);
--> statement-breakpoint
CREATE INDEX `payment_events_pending` ON `payment_events` (`processed_at`);--> statement-breakpoint
CREATE TABLE `payment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	`retry_at` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`safe_error` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_operations_kind" CHECK("payment_operations"."kind" IN ('CREATE_SESSION','REFUND')),
	CONSTRAINT "payment_operations_state" CHECK("payment_operations"."state" IN ('PENDING','DONE','FAILED','MANUAL'))
);
--> statement-breakpoint
CREATE INDEX `payment_operations_due` ON `payment_operations` (`state`,`retry_at`,`lease_until`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_order_status_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`cancellation_reason` text,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`actor_role` text,
	`actor_type` text DEFAULT 'USER' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "order_status_events_from_valid" CHECK("__new_order_status_events"."from_status" IS NULL OR "__new_order_status_events"."from_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_to_valid" CHECK("__new_order_status_events"."to_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_role_valid" CHECK(("__new_order_status_events"."actor_type" = 'USER' AND "__new_order_status_events"."actor_role" IN ('CUSTOMER','STAFF','ADMIN')) OR ("__new_order_status_events"."actor_type" = 'SYSTEM' AND "__new_order_status_events"."actor_role" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_order_status_events`("id", "order_id", "from_status", "to_status", "created_at", "cancellation_reason", "actor_user_id", "actor_name", "actor_role", "actor_type") SELECT "id", "order_id", "from_status", "to_status", "created_at", "cancellation_reason", "actor_user_id", "actor_name", "actor_role", 'USER' FROM `order_status_events`;--> statement-breakpoint
DROP TABLE `order_status_events`;--> statement-breakpoint
ALTER TABLE `__new_order_status_events` RENAME TO `order_status_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_status_events_order_idx` ON `order_status_events` (`order_id`,`id`);--> statement-breakpoint
ALTER TABLE `activity_events` ADD `actor_type` text DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_required` integer DEFAULT 0 NOT NULL CHECK(payment_required IN (0,1));--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_status` text DEFAULT 'LEGACY_UNPAID' NOT NULL CHECK(payment_status IN ('LEGACY_UNPAID','PENDING','PAID','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED'));--> statement-breakpoint
ALTER TABLE `orders` ADD `currency` text DEFAULT 'usd' NOT NULL CHECK(currency='usd');--> statement-breakpoint
ALTER TABLE `orders` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `refunded_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_refund_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `checkout_url` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `cancellation_intent` text;--> statement-breakpoint

CREATE UNIQUE INDEX `orders_session_unique` ON `orders` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_intent_unique` ON `orders` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_refund_unique` ON `orders` (`stripe_refund_id`);--> statement-breakpoint
CREATE INDEX `orders_payment_pending_idx` ON `orders` (`payment_status`,`expires_at`);
