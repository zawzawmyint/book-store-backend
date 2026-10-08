CREATE TABLE __delivery_empty_guard (count integer CHECK(count = 0));
--> statement-breakpoint
INSERT INTO __delivery_empty_guard SELECT count(*) FROM orders;
--> statement-breakpoint
DROP TABLE __delivery_empty_guard;
--> statement-breakpoint
CREATE TABLE `order_deliveries` (
	`order_id` integer PRIMARY KEY NOT NULL,
	`recipient_name` text NOT NULL,
	`phone` text NOT NULL,
	`address_line1` text NOT NULL,
	`address_line2` text,
	`city` text NOT NULL,
	`region` text,
	`postal_code` text,
	`country_code` text NOT NULL,
	`carrier` text,
	`tracking_number` text,
	`tracking_url` text,
	`shipped_at` text,
	`delivered_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_deliveries_timestamps" CHECK("order_deliveries"."delivered_at" IS NULL OR "order_deliveries"."shipped_at" IS NOT NULL),
	CONSTRAINT "order_deliveries_tracking" CHECK(("order_deliveries"."tracking_url" IS NULL OR "order_deliveries"."tracking_number" IS NOT NULL) AND ("order_deliveries"."tracking_number" IS NULL OR "order_deliveries"."carrier" IS NOT NULL))
);
--> statement-breakpoint
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
	CONSTRAINT "order_status_events_from_valid" CHECK("__new_order_status_events"."from_status" IS NULL OR "__new_order_status_events"."from_status" IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED')),
	CONSTRAINT "order_status_events_to_valid" CHECK("__new_order_status_events"."to_status" IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED')),
	CONSTRAINT "order_status_events_role_valid" CHECK(("__new_order_status_events"."actor_type" = 'USER' AND "__new_order_status_events"."actor_role" IN ('CUSTOMER','STAFF','ADMIN')) OR ("__new_order_status_events"."actor_type" = 'SYSTEM' AND "__new_order_status_events"."actor_role" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_order_status_events`("id", "order_id", "from_status", "to_status", "created_at", "cancellation_reason", "actor_user_id", "actor_name", "actor_role", "actor_type") SELECT "id", "order_id", "from_status", "to_status", "created_at", "cancellation_reason", "actor_user_id", "actor_name", "actor_role", "actor_type" FROM `order_status_events`;--> statement-breakpoint
DROP TABLE `order_status_events`;--> statement-breakpoint
ALTER TABLE `__new_order_status_events` RENAME TO `order_status_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `order_status_events_order_idx` ON `order_status_events` (`order_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`customer_name` text NOT NULL,
	`email` text NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`delivery_fee_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`payment_required` integer DEFAULT true NOT NULL,
	`payment_status` text DEFAULT 'PENDING' NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`expires_at` text,
	`paid_at` text,
	`refunded_at` text,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`stripe_refund_id` text,
	`checkout_url` text,
	`cancellation_intent` text,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_valid" CHECK("__new_orders"."status" IN ('SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
	CONSTRAINT "orders_delivery_money" CHECK("__new_orders"."subtotal_cents" >= 0 AND "__new_orders"."delivery_fee_cents" >= 0 AND "__new_orders"."total_cents" = "__new_orders"."subtotal_cents" + "__new_orders"."delivery_fee_cents"),
	CONSTRAINT "orders_total_nonnegative" CHECK("__new_orders"."total_cents" >= 0),
	CONSTRAINT "orders_payment_required_boolean" CHECK("__new_orders"."payment_required" IN (0,1)),
	CONSTRAINT "orders_payment_valid" CHECK("__new_orders"."payment_status" IN ('PENDING','PAID','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')),
	CONSTRAINT "orders_currency_usd" CHECK("__new_orders"."currency" = 'usd')
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "user_id", "customer_name", "email", "subtotal_cents", "delivery_fee_cents", "total_cents", "payment_required", "payment_status", "currency", "expires_at", "paid_at", "refunded_at", "stripe_session_id", "stripe_payment_intent_id", "stripe_refund_id", "checkout_url", "cancellation_intent", "status", "created_at") SELECT "id", "user_id", "customer_name", "email", "total_cents", 0, "total_cents", "payment_required", "payment_status", "currency", "expires_at", "paid_at", "refunded_at", "stripe_session_id", "stripe_payment_intent_id", "stripe_refund_id", "checkout_url", "cancellation_intent", "status", "created_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_session_unique` ON `orders` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_intent_unique` ON `orders` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_refund_unique` ON `orders` (`stripe_refund_id`);--> statement-breakpoint
CREATE INDEX `orders_payment_pending_idx` ON `orders` (`payment_status`,`expires_at`);--> statement-breakpoint
ALTER TABLE `checkout_requests` ADD `delivery_json` text NOT NULL;
