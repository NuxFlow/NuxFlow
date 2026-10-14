CREATE TABLE `hosting_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_text` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`max_storage_bytes` integer,
	`max_content_items` integer,
	`max_team_members` integer,
	`max_site_members` integer,
	`max_plugins` integer,
	`max_ai_calls_per_month` integer,
	`max_emails_per_month` integer,
	`max_views_per_month` integer,
	`max_renders_per_month` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sites` ADD `hosting_plan_id` text;