-- Reviewed additive form: avoid rebuilding books and preserve existing foreign keys and snapshots.
ALTER TABLE books ADD COLUMN details_revision integer DEFAULT 0 NOT NULL CONSTRAINT books_details_revision CHECK (details_revision BETWEEN 0 AND 2147483647);
