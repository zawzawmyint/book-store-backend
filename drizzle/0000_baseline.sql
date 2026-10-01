CREATE TABLE `books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`author` text NOT NULL,
	`genre` text NOT NULL,
	`description` text NOT NULL,
	`price_cents` integer NOT NULL,
	`stock` integer NOT NULL,
	CONSTRAINT "books_price_nonnegative" CHECK("books"."price_cents" >= 0),
	CONSTRAINT "books_stock_nonnegative" CHECK("books"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	`title` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_items_quantity_positive" CHECK("order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_nonnegative" CHECK("order_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_name` text NOT NULL,
	`email` text NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "orders_total_nonnegative" CHECK("orders"."total_cents" >= 0)
);
