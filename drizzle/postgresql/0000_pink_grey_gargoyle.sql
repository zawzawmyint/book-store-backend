CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actor_user_id" text,
	"actor_name" text NOT NULL,
	"actor_role" text,
	"actor_type" text DEFAULT 'USER' NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_name" text NOT NULL,
	"changes_json" text NOT NULL,
	"stock_delta" integer,
	"created_at" text DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "books_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"author" text NOT NULL,
	"genre" text NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"stock" integer NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "books_price_nonnegative" CHECK ("books"."price_cents" >= 0),
	CONSTRAINT "books_stock_nonnegative" CHECK ("books"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checkout_requests" (
	"user_id" text NOT NULL,
	"request_key" text NOT NULL,
	"lines_json" text NOT NULL,
	"order_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_nonnegative" CHECK ("order_items"."unit_price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"created_at" text DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"cancellation_reason" text,
	"actor_user_id" text,
	"actor_name" text NOT NULL,
	"actor_role" text,
	"actor_type" text DEFAULT 'USER' NOT NULL,
	CONSTRAINT "order_status_events_from_valid" CHECK ("order_status_events"."from_status" IS NULL OR "order_status_events"."from_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_to_valid" CHECK ("order_status_events"."to_status" IN ('SUBMITTED','ACCEPTED','COMPLETED','CANCELLED')),
	CONSTRAINT "order_status_events_role_valid" CHECK (("order_status_events"."actor_type" = 'USER' AND "order_status_events"."actor_role" IN ('CUSTOMER','STAFF','ADMIN')) OR ("order_status_events"."actor_type" = 'SYSTEM' AND "order_status_events"."actor_role" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text,
	"customer_name" text NOT NULL,
	"email" text NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_required" boolean DEFAULT false NOT NULL,
	"payment_status" text DEFAULT 'LEGACY_UNPAID' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"expires_at" text,
	"paid_at" text,
	"refunded_at" text,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_refund_id" text,
	"checkout_url" text,
	"cancellation_intent" text,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"created_at" text DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') NOT NULL,
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" IN ('SUBMITTED', 'ACCEPTED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "orders_total_nonnegative" CHECK ("orders"."total_cents" >= 0),
	CONSTRAINT "orders_payment_valid" CHECK ("orders"."payment_status" IN ('LEGACY_UNPAID','PENDING','PAID','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED')),
	CONSTRAINT "orders_currency_usd" CHECK ("orders"."currency" = 'usd')
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" bigint NOT NULL,
	"processed_at" bigint,
	"safe_error" text
);
--> statement-breakpoint
CREATE TABLE "payment_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"created_at" bigint NOT NULL,
	"retry_at" bigint NOT NULL,
	"lease_until" bigint DEFAULT 0 NOT NULL,
	"lease_token" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"safe_error" text,
	CONSTRAINT "payment_operations_kind" CHECK ("payment_operations"."kind" IN ('CREATE_SESSION','REFUND')),
	CONSTRAINT "payment_operations_state" CHECK ("payment_operations"."state" IN ('PENDING','DONE','FAILED','MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "user_roles_valid_role" CHECK ("user_roles"."role" IN ('CUSTOMER', 'STAFF', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_newest_idx" ON "activity_events" USING btree ("id");--> statement-breakpoint
CREATE INDEX "activity_target_idx" ON "activity_events" USING btree ("target_type","target_id","id");--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "activity_events" USING btree ("actor_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_requests_owner_key" ON "checkout_requests" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_requests_order" ON "checkout_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_events_order_idx" ON "order_status_events" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_session_unique" ON "orders" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_intent_unique" ON "orders" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_refund_unique" ON "orders" USING btree ("stripe_refund_id");--> statement-breakpoint
CREATE INDEX "orders_payment_pending_idx" ON "orders" USING btree ("payment_status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_events_pending" ON "payment_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "payment_operations_due" ON "payment_operations" USING btree ("state","retry_at","lease_until");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");