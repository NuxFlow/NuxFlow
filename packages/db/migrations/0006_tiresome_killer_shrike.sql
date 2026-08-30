CREATE TABLE `dynamic_plugin_trust` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`publisher_public_key` text NOT NULL,
	`first_installed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dynamic_plugin_trust_site_plugin` ON `dynamic_plugin_trust` (`site_id`,`plugin_id`);