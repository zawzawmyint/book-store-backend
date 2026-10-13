CREATE TABLE `account_cart_items` (
	`user_id` text NOT NULL,
	`book_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`line_version` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `account_carts`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cart_items_quantity" CHECK("account_cart_items"."quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_owner_book` ON `account_cart_items` (`user_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `account_carts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` text DEFAULT '0' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cart_operations` (
	`user_id` text NOT NULL,
	`request_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`notices_json` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `account_carts`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_operations_owner_key` ON `cart_operations` (`user_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `checkout_cart_snapshots` (
	`order_id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lines_json` text NOT NULL,
	`cleaned_at` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `account_carts`(`user_id`) ON UPDATE no action ON DELETE cascade
);
