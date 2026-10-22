-- Hand-edited (drizzle-kit emitted a copy-and-rename rebuild): site_auth_codes.site_id
-- loses its FK to sites, so codes can be issued for sites in a member pool's own D1.
-- Codes live 60 seconds, so the table is simply recreated instead of copied — at worst a
-- sign-in in flight during the deploy is asked to try again. Every statement is safe to
-- re-run (the migration runner applies them one at a time, without a transaction).
-- Nothing references site_auth_codes, so dropping it cascades nowhere.
DROP TABLE IF EXISTS `__new_site_auth_codes`;--> statement-breakpoint
DROP TABLE IF EXISTS `site_auth_codes`;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `site_auth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
