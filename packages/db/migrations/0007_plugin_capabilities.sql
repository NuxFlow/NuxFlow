CREATE TABLE `plugin_storage` (
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`size` integer NOT NULL,
	`expires_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `plugin_id`, `key`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plugin_storage_expires` ON `plugin_storage` (`expires_at`);--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `capabilities` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `capabilities_checksum` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `granted_permissions` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `settings_values` text;--> statement-breakpoint
ALTER TABLE `dynamic_plugins` ADD `updated_at` text;