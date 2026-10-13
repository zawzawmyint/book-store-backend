CREATE TABLE "account_cart_items" (
	"user_id" text NOT NULL,
	"book_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_version" text NOT NULL,
	CONSTRAINT "cart_items_quantity" CHECK ("account_cart_items"."quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "account_carts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"revision" text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_operations" (
	"user_id" text NOT NULL,
	"request_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"notices_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_cart_snapshots" (
	"order_id" integer PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lines_json" text NOT NULL,
	"cleaned_at" text
);
--> statement-breakpoint
ALTER TABLE "account_cart_items" ADD CONSTRAINT "account_cart_items_user_id_account_carts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_carts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_cart_items" ADD CONSTRAINT "account_cart_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_carts" ADD CONSTRAINT "account_carts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_operations" ADD CONSTRAINT "cart_operations_user_id_account_carts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_carts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_cart_snapshots" ADD CONSTRAINT "checkout_cart_snapshots_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_cart_snapshots" ADD CONSTRAINT "checkout_cart_snapshots_user_id_account_carts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."account_carts"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_owner_book" ON "account_cart_items" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_operations_owner_key" ON "cart_operations" USING btree ("user_id","request_key");