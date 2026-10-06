CREATE TABLE `user_roles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_roles_valid_role" CHECK("user_roles"."role" IN ('CUSTOMER', 'STAFF', 'ADMIN'))
);
--> statement-breakpoint
INSERT INTO `user_roles` (`user_id`, `role`) SELECT `user_id`, 'ADMIN' FROM `admin_memberships`;
--> statement-breakpoint
DROP TABLE `admin_memberships`;
