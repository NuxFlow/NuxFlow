CREATE TABLE `site_auth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `site_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_invitations_site_user` ON `site_invitations` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_site_invitations_user` ON `site_invitations` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_sessions_token_hash_unique` ON `site_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_site_sessions_user` ON `site_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_site_sessions_parent` ON `site_sessions` (`parent_session_id`);--> statement-breakpoint
ALTER TABLE `sites` ADD `is_primary` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the primary site is the operator's own — the site holding the earliest
-- super_admin grant (the first-ever install's owner), or failing that the oldest site.
UPDATE `sites` SET `is_primary` = 1 WHERE `id` = (SELECT `site_id` FROM `user_site_roles` WHERE `role` = 'super_admin' ORDER BY `created_at` ASC LIMIT 1);--> statement-breakpoint
UPDATE `sites` SET `is_primary` = 1 WHERE NOT EXISTS (SELECT 1 FROM `sites` WHERE `is_primary` = 1) AND `id` = (SELECT `id` FROM `sites` ORDER BY `created_at` ASC LIMIT 1);
