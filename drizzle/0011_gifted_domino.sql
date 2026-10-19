ALTER TABLE `books` ADD `cover_key` text;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_width` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_height` integer;
--> statement-breakpoint
ALTER TABLE `books` ADD `cover_revision` integer DEFAULT 0 NOT NULL CONSTRAINT books_cover_revision CHECK (cover_revision >= 0) CONSTRAINT books_cover_metadata CHECK ((cover_key IS NULL AND cover_width IS NULL AND cover_height IS NULL) OR (cover_key IS NOT NULL AND cover_width IS NOT NULL AND cover_height IS NOT NULL AND cover_width > 0 AND cover_height > 0));
