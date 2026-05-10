CREATE TABLE `dynamic_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`has_server` integer DEFAULT false NOT NULL,
	`has_client` integer DEFAULT false NOT NULL,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dynamic_plugins_site` ON `dynamic_plugins` (`site_id`);
