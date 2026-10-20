CREATE TABLE "in_app_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"recipient_id" text NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"required_role" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" text NOT NULL,
	"read_at" text,
	CONSTRAINT "in_app_notifications_scope" CHECK ("in_app_notifications"."scope" IN ('STOREFRONT','WORKSPACE')),
	CONSTRAINT "in_app_notifications_kind" CHECK ("in_app_notifications"."kind" IN ('PAYMENT_CONFIRMED', 'ORDER_ACCEPTED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'REFUND_COMPLETED', 'NEW_PAID_ORDER', 'STOCK_LOW', 'STOCK_OUT', 'REFUND_FAILED')),
	CONSTRAINT "in_app_notifications_role" CHECK ("in_app_notifications"."required_role" IN ('VERIFIED','STAFF','ADMIN')),
	CONSTRAINT "in_app_notifications_resource" CHECK ("in_app_notifications"."resource_type" IN ('ORDER','BOOK')),
	CONSTRAINT "in_app_notifications_key_length" CHECK (length("in_app_notifications"."event_key") BETWEEN 1 AND 256),
	CONSTRAINT "in_app_notifications_payload_length" CHECK (length("in_app_notifications"."payload") BETWEEN 1 AND 2048)
);
--> statement-breakpoint
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "in_app_notifications_dedupe" ON "in_app_notifications" USING btree ("event_key","recipient_id","scope");--> statement-breakpoint
CREATE INDEX "in_app_notifications_feed" ON "in_app_notifications" USING btree ("recipient_id","scope","created_at","id");--> statement-breakpoint
CREATE INDEX "in_app_notifications_unread" ON "in_app_notifications" USING btree ("recipient_id","scope","read_at");--> statement-breakpoint
CREATE INDEX "in_app_notifications_retention" ON "in_app_notifications" USING btree ("created_at");