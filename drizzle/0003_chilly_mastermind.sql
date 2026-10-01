ALTER TABLE `books` ADD COLUMN `archived` integer DEFAULT 0 NOT NULL CHECK (`archived` IN (0, 1));
