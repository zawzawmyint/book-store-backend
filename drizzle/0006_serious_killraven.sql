CREATE TABLE `order_status_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`cancellation_reason` text,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`actor_role` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "order_status_events_from_valid" CHECK("order_status_events"."from_status" IS NULL OR "order_status_events"."from_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_to_valid" CHECK("order_status_events"."to_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_role_valid" CHECK("order_status_events"."actor_role" IN ('CUSTOMER','STAFF','ADMIN'))
);
--> statement-breakpoint
CREATE INDEX `order_status_events_order_idx` ON `order_status_events` (`order_id`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`customer_name` text NOT NULL,
	`email` text NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_valid" CHECK("__new_orders"."status" IN ('SUBMITTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_total_nonnegative" CHECK("__new_orders"."total_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "user_id", "customer_name", "email", "total_cents", "status", "created_at") SELECT "id", "user_id", "customer_name", "email", "total_cents", 'SUBMITTED', "created_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);
