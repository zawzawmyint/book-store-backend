DO $$ BEGIN IF EXISTS (SELECT 1 FROM orders) THEN RAISE EXCEPTION 'Delivery requires a fresh database; existing orders must not be relabeled'; END IF; END $$;
--> statement-breakpoint
CREATE TABLE "order_deliveries" (
	"order_id" integer PRIMARY KEY NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"region" text,
	"postal_code" text,
	"country_code" text NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_at" text,
	"delivered_at" text,
	CONSTRAINT "order_deliveries_timestamps" CHECK ("order_deliveries"."delivered_at" IS NULL OR "order_deliveries"."shipped_at" IS NOT NULL),
	CONSTRAINT "order_deliveries_tracking" CHECK (("order_deliveries"."tracking_url" IS NULL OR "order_deliveries"."tracking_number" IS NOT NULL) AND ("order_deliveries"."tracking_number" IS NULL OR "order_deliveries"."carrier" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "order_status_events" DROP CONSTRAINT "order_status_events_from_valid";--> statement-breakpoint
ALTER TABLE "order_status_events" DROP CONSTRAINT "order_status_events_to_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_payment_valid";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_required" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "payment_status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD COLUMN "delivery_json" text NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_from_valid" CHECK ("order_status_events"."from_status" IS NULL OR "order_status_events"."from_status" IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED'));--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_to_valid" CHECK ("order_status_events"."to_status" IN ('SUBMITTED','PREPARING','SHIPPED','DELIVERED','CANCELLED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_money" CHECK ("orders"."subtotal_cents" >= 0 AND "orders"."delivery_fee_cents" >= 0 AND "orders"."total_cents" = "orders"."subtotal_cents" + "orders"."delivery_fee_cents");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("orders"."status" IN ('SUBMITTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_valid" CHECK ("orders"."payment_status" IN ('PENDING','PAID','EXPIRED','REFUND_PENDING','REFUNDED','REFUND_FAILED'));
