CREATE TABLE `site_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`moved_site_id` text NOT NULL,
	`site_name` text NOT NULL,
	`site_domain` text NOT NULL,
	`from_pool` text,
	`to_pool` text,
	`phase` text NOT NULL,
	`cursor` text,
	`counts` text,
	`error` text,
	`started_by` text,
	`locked_at` text,
	`copy_started_at` text,
	`switched_at` text,
	`locked_until` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_moves_active` ON `site_moves` (`moved_site_id`) WHERE "site_moves"."phase" not in ('done', 'cancelled');--> statement-breakpoint
ALTER TABLE `sites` ADD `move_state` text;