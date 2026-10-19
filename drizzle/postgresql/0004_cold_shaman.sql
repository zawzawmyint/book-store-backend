ALTER TABLE "books" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "cover_width" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "cover_height" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "cover_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_cover_revision" CHECK ("books"."cover_revision" >= 0);--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_cover_metadata" CHECK (("books"."cover_key" IS NULL AND "books"."cover_width" IS NULL AND "books"."cover_height" IS NULL) OR ("books"."cover_key" IS NOT NULL AND "books"."cover_width" IS NOT NULL AND "books"."cover_height" IS NOT NULL AND "books"."cover_width" > 0 AND "books"."cover_height" > 0));